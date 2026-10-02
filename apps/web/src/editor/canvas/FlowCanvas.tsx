import type { GraphDoc, Issue, Position, ToolDefinition } from '@agent-flow/core';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type FinalConnectionState,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MousePointerClick } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveChange } from '../useFlow';
import { AnnotationLayer } from '../annotate/AnnotationLayer';
import type { Annotation } from '../annotate/message';
import { alignToNeighbours, errorJumps, GRID, nodeSize, resolvePositions } from '../layout';
import { edgeColor, edgeTypes, type CanvasEdge, type EdgeKind, type FlowEdgeData } from './edges';
import { nodeTypes, type CanvasNode, type RunMark } from './nodes';
import { Toolbar } from './Toolbar';
import { SETTLE_MS, useLivePlayback } from './useLivePlayback';

export type CanvasInstance = ReactFlowInstance<CanvasNode, CanvasEdge>;

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

export interface RunTrace {
  marks: Map<string, RunMark>;
  edges: Set<string>;
}

/** Canvas covered by floating chrome, in screen pixels: the header bar on top, the dock on the right or bottom. */
export interface Insets {
  right: number;
  bottom: number;
}

const HEADER_SPACE = 68;
/** Minimap for a canvas this size: 15% of its width within 140-240px, shaped like the canvas but never taller than wide. */
export function minimapSize(width: number, height: number) {
  const w = Math.round(Math.min(240, Math.max(140, width * 0.15)));
  return { width: w, height: Math.round(Math.min(w, Math.max(80, (w * height) / Math.max(width, 1)))) };
}
/** Room the minimap takes in the bottom-right corner, margins included. */
export const minimapSpace = (minimap: { width: number }) => minimap.width + 24;
const TOOLBAR_SPACE = 76;

/** Fit padding that keeps the flow clear of the floating chrome. */
export const fitPadding = (insets: Insets) => ({ top: `${HEADER_SPACE}px`, left: '24px', right: `${insets.right + 24}px`, bottom: `${Math.max(insets.bottom, TOOLBAR_SPACE) + 16}px` }) as const;

/** Centres a flow point in the uncovered part of the canvas. */
export function centerOn(rf: CanvasInstance, x: number, y: number, insets: Insets, zoom = rf.getZoom()) {
  return rf.setCenter(x + insets.right / 2 / zoom, y + (insets.bottom - HEADER_SPACE) / 2 / zoom, { zoom, duration: 300 });
}

interface Props {
  doc: GraphDoc;
  issues: Issue[];
  toolsByName: Map<string, ToolDefinition>;
  trace: RunTrace | null;
  /** Someone else's latest change, played back as it arrives. */
  live: LiveChange | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onConnect: (source: string, target: string) => void;
  /** A connection dragged from `source` and dropped on empty canvas. */
  onConnectToNew: (source: string, position: Position) => void;
  onInsertOnEdge: (edgeId: string) => void;
  onMove: (positions: Record<string, Position>) => void;
  onDelete: (selection: NonNullable<Selection>[]) => void;
  onAddStep: () => void;
  onAddEnd: () => void;
  onTidy: () => void;
  onAnnotate: () => void;
  /** Present while the reviewer is annotating; the canvas is then frozen under the annotation layer. */
  annotate: { mode: 'send' | 'copy'; onSend: (annotations: Annotation[]) => Promise<void>; onExit: () => void } | null;
  onReady: (instance: CanvasInstance) => void;
  /** Viewing a published version: selection only. */
  readOnly?: boolean;
  insets: Insets;
  /** A narrow canvas: icon-only toolbar. */
  compact: boolean;
  /** Bottom right, beside the toolbar, while the panel is closed; its size, or null to hide it. */
  minimap: { width: number; height: number } | null;
  /** Width covered along the bottom-right edge (the open panel or the minimap); the toolbar keeps clear of it. */
  bottomRight: number;
}

const JUMP_PREFIX = 'jump:';
const MINIMAP_COLOR = { start: '#10b981', tool: '#6366f1', end: '#94a3b8' } as const;
/** After the reviewer pans or zooms, playback stops moving the view for this long. */
const HANDS_OFF_MS = 3000;
const FOLLOW_MARGIN = 32;

const ease = (t: number) => 1 - (1 - t) ** 3;

export function FlowCanvas(props: Props) {
  const { doc, issues, toolsByName, trace, selection, onSelect, readOnly = false } = props;
  const instance = useRef<CanvasInstance | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const userMovedAt = useRef(0);

  /**
   * Keeps what playback just showed in view, unless the reviewer is steering the view. Called with null when a
   * sequence ends: if the layout moved everything off screen meanwhile, the whole flow is brought back.
   */
  const follow = (ids: string[] | null) => {
    const rf = instance.current;
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rf || !rect || Date.now() - userMovedAt.current < HANDS_OFF_MS) return;
    const { insets } = props;
    const bounds = { left: rect.left, top: rect.top + HEADER_SPACE, right: rect.right - insets.right, bottom: rect.bottom - Math.max(insets.bottom, TOOLBAR_SPACE) };
    const box = (list: CanvasNode[]) => {
      const rects = list.map((n) => ({ ...n.position, ...nodeSize(n.data.node.type) }));
      const x = Math.min(...rects.map((r) => r.x));
      const y = Math.min(...rects.map((r) => r.y));
      return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
    };
    const corners = (r: { x: number; y: number; width: number; height: number }) => [rf.flowToScreenPosition(r), rf.flowToScreenPosition({ x: r.x + r.width, y: r.y + r.height })] as const;

    if (!ids) {
      const onScreen = rf.getNodes().some((n) => {
        const [a, b] = corners(box([n]));
        return !n.hidden && b.x > bounds.left && a.x < bounds.right && b.y > bounds.top && a.y < bounds.bottom;
      });
      if (!onScreen) void rf.fitView({ padding: fitPadding(insets), maxZoom: 1, duration: 400 });
      return;
    }
    const shown = ids.flatMap((id) => rf.getNode(id) ?? []);
    if (!shown.length) return;
    const target = box(shown);
    const [a, b] = corners(target);
    const inside = a.x > bounds.left + FOLLOW_MARGIN && b.x < bounds.right - FOLLOW_MARGIN && a.y > bounds.top + FOLLOW_MARGIN && b.y < bounds.bottom - FOLLOW_MARGIN;
    if (!inside) void centerOn(rf, target.x + target.width / 2, target.y + target.height / 2, insets);
  };
  const playback = useLivePlayback(props.live, follow);

  const derived = useMemo<CanvasNode[]>(() => {
    const positions = resolvePositions(doc);
    const titles = new Map(doc.nodes.map((n) => [n.id, n.title]));
    const current = doc.nodes.map((node): CanvasNode => ({
      id: node.id,
      type: node.type,
      position: positions[node.id]!,
      deletable: node.type !== 'start',
      selected: selection?.kind === 'node' && selection.id === node.id,
      hidden: playback.hidden.has(node.id),
      data: {
        node,
        tool: node.tool ? toolsByName.get(node.tool.name) : undefined,
        issues: issues.filter((i) => i.nodeId === node.id),
        runMark: trace?.marks.get(node.id),
        errorTarget: node.onError?.targetNodeId ? titles.get(node.onError.targetNodeId) : undefined,
        motion: playback.entering.has(node.id) ? 'enter' : playback.flashing.has(node.id) ? 'flash' : undefined,
      },
    }));
    if (!playback.ghosts || !props.live) return current;
    const before = resolvePositions(props.live.from);
    const ghosts = playback.ghosts.nodes.map((node): CanvasNode => ({
      id: node.id,
      type: node.type,
      position: before[node.id]!,
      selectable: false,
      draggable: false,
      deletable: false,
      data: { node, tool: node.tool ? toolsByName.get(node.tool.name) : undefined, issues: [], motion: 'leave' },
    }));
    return [...current, ...ghosts];
  }, [doc, issues, toolsByName, trace, selection, playback]);

  // Local copy so dragging is smooth; the server copy wins whenever it changes.
  // Sizes React Flow measured carry over: a node without them is re-measured and its edges vanish for a frame.
  // On a live change, nodes the new layout moves glide there instead of jumping.
  const [nodes, setNodes] = useState(derived);
  const shown = useRef(nodes);
  shown.current = nodes;
  const glided = useRef<number | null>(null);
  useEffect(() => {
    const measured = new Map(shown.current.map((n) => [n.id, n.measured]));
    const place = (at: (n: CanvasNode) => CanvasNode['position']) => derived.map((n) => ({ ...n, position: at(n), measured: measured.get(n.id) }));
    if (!playback.animate || playback.revision === glided.current) return setNodes(place((n) => n.position));
    glided.current = playback.revision;
    const from = new Map(shown.current.map((n) => [n.id, n.position]));
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - start) / SETTLE_MS));
      setNodes(
        place((n) => {
          const p = from.get(n.id);
          return p ? { x: p.x + (n.position.x - p.x) * k, y: p.y + (n.position.y - p.y) * k } : n.position;
        }),
      );
      if (k < 1) frame = requestAnimationFrame(step);
    };
    // The first frame goes out now, so hidden and fading elements take effect even if frames are slow.
    step(start);
    return () => cancelAnimationFrame(frame);
  }, [derived]);

  const edges = useMemo<CanvasEdge[]>(() => {
    const outDegree = new Map<string, number>();
    for (const e of doc.edges) outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
    const invalid = new Set(issues.filter((i) => i.edgeId && i.severity === 'error').map((i) => i.edgeId));

    const make = (id: string, source: string, target: string, data: FlowEdgeData, selected = false): CanvasEdge => ({
      id,
      source,
      target,
      type: 'flow',
      selected,
      hidden: playback.hidden.has(id),
      selectable: !id.startsWith(JUMP_PREFIX) && data.motion !== 'leave',
      deletable: !id.startsWith(JUMP_PREFIX) && data.motion !== 'leave',
      data: { ...data, motion: data.motion ?? (playback.entering.has(id) ? 'enter' : undefined) },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(data), width: 14, height: 14 },
    });

    const flowEdges = doc.edges.map((e) => {
      const selected = selection?.kind === 'edge' && selection.id === e.id;
      const branches = (outDegree.get(e.source) ?? 0) > 1;
      const kind: EdgeKind = !branches ? 'plain' : e.condition ? 'branch' : e.isDefault ? 'fallback' : 'branch';
      const label = !branches ? undefined : e.condition || (e.isDefault ? 'Otherwise' : 'Needs a condition');
      const tone = selected ? 'selected' : invalid.has(e.id) ? 'invalid' : trace?.edges.has(e.id) ? 'trace' : 'normal';
      return make(e.id, e.source, e.target, { kind, tone, label, onInsert: readOnly ? undefined : () => props.onInsertOnEdge(e.id) }, selected);
    });
    const jumpEdges = errorJumps(doc.nodes).map((j) => make(`${JUMP_PREFIX}${j.source}`, j.source, j.target, { kind: 'error', tone: 'normal', label: 'On error' }));
    const ghostEdges = (playback.ghosts?.edges ?? []).map((e) => make(e.id, e.source, e.target, { kind: 'plain', tone: 'normal', motion: 'leave' }));
    return [...jumpEdges, ...flowEdges, ...ghostEdges];
  }, [doc, issues, trace, selection, readOnly, playback]);

  // A single dragged node lines up with a connected node it is close to.
  const handleNodesChange = (changes: NodeChange<CanvasNode>[]) =>
    setNodes((ns) => {
      const dragged = changes.filter((c) => c.type === 'position' && c.dragging && c.position);
      const at = Object.fromEntries(ns.map((n) => [n.id, n.position]));
      const adjusted = changes.map((c) => (dragged.length === 1 && c === dragged[0] && c.type === 'position' && c.position ? { ...c, position: alignToNeighbours(doc, c.id, c.position, at) } : c));
      return applyNodeChanges(adjusted.filter((c) => c.type !== 'remove'), ns);
    });

  const handleConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (readOnly || state.isValid || !state.fromNode || state.fromHandle?.type !== 'source' || !instance.current) return;
    const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
    const drop = instance.current.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const { width } = nodeSize('tool');
    // Dropped roughly under the source: line up with it so the edge runs straight.
    const from = state.fromNode;
    const sourceCenter = from.internals.positionAbsolute.x + (from.measured.width ?? 0) / 2;
    const centerX = Math.abs(drop.x - sourceCenter) < width / 2 ? sourceCenter : drop.x;
    props.onConnectToNew(from.id, { x: Math.round(centerX - width / 2), y: Math.round(drop.y) });
  };

  const isBlank = doc.edges.length === 0 && doc.nodes.length <= 2;
  const { annotate } = props;
  const editable = !readOnly && !annotate;

  return (
    <ReactFlow
      ref={wrapper}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={(rf) => {
        instance.current = rf;
        props.onReady(rf);
      }}
      onNodesChange={handleNodesChange}
      onNodeClick={(_, n) => onSelect({ kind: 'node', id: n.id })}
      onEdgeClick={(_, e) => onSelect(e.id.startsWith(JUMP_PREFIX) ? { kind: 'node', id: e.source } : { kind: 'edge', id: e.id })}
      onPaneClick={() => onSelect(null)}
      onMoveStart={(event) => {
        if (event) userMovedAt.current = Date.now();
      }}
      onMoveEnd={(event) => {
        if (event) userMovedAt.current = Date.now();
      }}
      onConnect={(c: Connection) => c.source && c.target && c.source !== c.target && props.onConnect(c.source, c.target)}
      onConnectEnd={handleConnectEnd}
      onNodeDragStop={(_, __, dragged) =>
        props.onMove(
          Object.fromEntries(
            dragged.map((n) => {
              // Where the canvas shows the node, which includes the alignment above.
              const p = shown.current.find((s) => s.id === n.id)?.position ?? n.position;
              return [n.id, { x: Math.round(p.x), y: Math.round(p.y) }];
            }),
          ),
        )
      }
      onBeforeDelete={async ({ nodes: ns, edges: es }) => {
        props.onDelete([...ns.map((n) => ({ kind: 'node' as const, id: n.id })), ...es.map((e) => ({ kind: 'edge' as const, id: e.id }))]);
        return false;
      }}
      deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
      nodesDraggable={editable}
      nodesConnectable={editable}
      connectionRadius={32}
      snapToGrid
      snapGrid={[GRID, GRID]}
      fitView
      fitViewOptions={{ padding: fitPadding(props.insets), maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      panOnScroll
      minZoom={0.15}
      maxZoom={1.75}
      className="af-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
      {annotate ? (
        <AnnotationLayer doc={doc} mode={annotate.mode} onSend={annotate.onSend} onExit={annotate.onExit} />
      ) : (
        !props.insets.bottom && (
          <Toolbar
            readOnly={readOnly}
            onAddStep={props.onAddStep}
            onAddEnd={props.onAddEnd}
            onTidy={props.onTidy}
            onAnnotate={props.onAnnotate}
            compact={props.compact}
            reserve={props.bottomRight}
            fit={fitPadding(props.insets)}
          />
        )
      )}
      {props.minimap && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="!mr-3 !mb-4 overflow-hidden rounded-xl border border-slate-200 shadow-lg shadow-slate-900/5"
          style={props.minimap}
          maskColor="rgba(241, 245, 249, 0.7)"
          nodeColor={(n) => MINIMAP_COLOR[n.type as keyof typeof MINIMAP_COLOR] ?? '#94a3b8'}
          nodeBorderRadius={6}
        />
      )}
      {playback.actor && !annotate && (
        <Panel position="top-left" className="!mt-[64px] !ml-3">
          <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-indigo-200 bg-white/95 px-3.5 py-1.5 text-[12.5px] font-medium text-slate-700 shadow-lg shadow-slate-900/5 backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-indigo-500" />
            </span>
            {playback.actor} is editing
          </div>
        </Panel>
      )}
      {isBlank && editable && !playback.actor && (
        <Panel position="top-center" className="!mt-[68px]" style={{ translate: `${-props.insets.right / 2}px 0` }}>
          <div className="flex max-w-md items-start gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur">
            <MousePointerClick size={18} className="mt-0.5 shrink-0 text-indigo-500" />
            <div className="text-[13px] leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-900">Start building.</span> Drag from the dot under <em>Start</em> onto the canvas to add the first step, or ask your agent to build the flow over MCP.
            </div>
          </div>
        </Panel>
      )}
    </ReactFlow>
  );
}
