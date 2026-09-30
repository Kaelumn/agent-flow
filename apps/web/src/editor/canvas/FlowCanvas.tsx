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
import { errorJumps, nodeSize, resolvePositions } from '../layout';
import { edgeColor, edgeTypes, type CanvasEdge, type EdgeKind, type FlowEdgeData } from './edges';
import { nodeTypes, type CanvasNode, type RunMark } from './nodes';
import { Toolbar } from './Toolbar';

export type CanvasInstance = ReactFlowInstance<CanvasNode, CanvasEdge>;

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

export interface RunTrace {
  marks: Map<string, RunMark>;
  edges: Set<string>;
}

interface Props {
  doc: GraphDoc;
  issues: Issue[];
  toolsByName: Map<string, ToolDefinition>;
  openFeedbackByNode: Map<string, number>;
  trace: RunTrace | null;
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
  onReady: (instance: CanvasInstance) => void;
  /** Viewing a published version: selection only. */
  readOnly?: boolean;
}

const JUMP_PREFIX = 'jump:';
const MINIMAP_COLOR = { start: '#10b981', tool: '#6366f1', end: '#94a3b8' } as const;

export function FlowCanvas(props: Props) {
  const { doc, issues, toolsByName, openFeedbackByNode, trace, selection, onSelect, readOnly = false } = props;
  const instance = useRef<CanvasInstance | null>(null);

  const derived = useMemo<CanvasNode[]>(() => {
    const positions = resolvePositions(doc);
    const titles = new Map(doc.nodes.map((n) => [n.id, n.title]));
    return doc.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: positions[node.id]!,
      deletable: node.type !== 'start',
      selected: selection?.kind === 'node' && selection.id === node.id,
      data: {
        node,
        tool: node.tool ? toolsByName.get(node.tool.name) : undefined,
        issues: issues.filter((i) => i.nodeId === node.id),
        openFeedback: openFeedbackByNode.get(node.id) ?? 0,
        runMark: trace?.marks.get(node.id),
        errorTarget: node.onError?.targetNodeId ? titles.get(node.onError.targetNodeId) : undefined,
      },
    }));
  }, [doc, issues, toolsByName, openFeedbackByNode, trace, selection]);

  // Local copy so dragging is smooth; the server copy wins whenever it changes.
  const [nodes, setNodes] = useState(derived);
  useEffect(() => setNodes(derived), [derived]);

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
      selectable: !id.startsWith(JUMP_PREFIX),
      deletable: !id.startsWith(JUMP_PREFIX),
      data,
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
    return [...jumpEdges, ...flowEdges];
  }, [doc, issues, trace, selection, readOnly]);

  const handleNodesChange = (changes: NodeChange<CanvasNode>[]) => setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns));

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

  return (
    <ReactFlow
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
      onConnect={(c: Connection) => c.source && c.target && c.source !== c.target && props.onConnect(c.source, c.target)}
      onConnectEnd={handleConnectEnd}
      onNodeDragStop={(_, __, dragged) => props.onMove(Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])))}
      onBeforeDelete={async ({ nodes: ns, edges: es }) => {
        props.onDelete([...ns.map((n) => ({ kind: 'node' as const, id: n.id })), ...es.map((e) => ({ kind: 'edge' as const, id: e.id }))]);
        return false;
      }}
      deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      connectionRadius={32}
      snapToGrid
      snapGrid={[8, 8]}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.75}
      className="af-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
      <Toolbar readOnly={readOnly} onAddStep={props.onAddStep} onAddEnd={props.onAddEnd} onTidy={props.onTidy} />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="!mr-4 !mb-5 overflow-hidden rounded-xl border border-slate-200 shadow-lg shadow-slate-900/5"
        style={{ width: 176, height: 116 }}
        maskColor="rgba(241, 245, 249, 0.7)"
        nodeColor={(n) => MINIMAP_COLOR[n.type as keyof typeof MINIMAP_COLOR] ?? '#94a3b8'}
        nodeBorderRadius={6}
      />
      {isBlank && !readOnly && (
        <Panel position="top-center" className="!mt-6">
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
