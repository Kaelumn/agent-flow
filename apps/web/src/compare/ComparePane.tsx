import type { FlowNode, GraphDoc, Mark, Position, ToolDefinition } from '@agent-flow/core';
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  getBezierPath,
  MarkerType,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, type ComponentType } from 'react';
import { cx } from '../components/ui';
import { OUT_HANDLE, nodeTypes as cardTypes, type BranchRow, type FlowNodeData } from '../editor/canvas/nodes';
import { nodeHeight, nodeSize } from '../editor/layout';

/** What the marks look like: added is green, removed red and dashed, changed amber. */
const NODE_MARK: Record<Mark, string> = {
  same: '',
  added: 'ring-2 ring-emerald-500 ring-offset-2',
  changed: 'ring-2 ring-amber-400 ring-offset-2',
  removed: 'outline-2 outline-offset-2 outline-red-400 outline-dashed opacity-80',
};
const BADGE: Record<Exclude<Mark, 'same'>, { text: string; className: string }> = {
  added: { text: 'Added', className: 'bg-emerald-500 text-white' },
  changed: { text: 'Modified', className: 'bg-amber-400 text-amber-950' },
  removed: { text: 'Removed', className: 'bg-red-500 text-white' },
};
const EDGE_STROKE: Record<Mark, string> = { same: '#94a3b8', added: '#10b981', changed: '#f59e0b', removed: '#ef4444' };

interface DiffData extends FlowNodeData {
  mark: Mark;
  /** Everything that did not change is faded, so the changes stand out. */
  dim: boolean;
}

/** An existing step card, unchanged, inside a frame that carries the change mark. */
const framed = (Card: ComponentType<NodeProps<Node<FlowNodeData>>>) =>
  function FramedCard(props: NodeProps<Node<DiffData>>) {
    const { mark, dim } = props.data;
    return (
      <div className={cx('rounded-2xl transition-opacity', NODE_MARK[mark], dim && mark === 'same' && 'opacity-30')}>
        {mark !== 'same' && <span className={cx('absolute -top-2.5 right-3 z-10 rounded-full px-2 py-px text-[10px] font-semibold', BADGE[mark].className)}>{BADGE[mark].text}</span>}
        <Card {...(props as unknown as NodeProps<Node<FlowNodeData>>)} />
      </div>
    );
  };

/** Where a step is on the other side but not on this one: an empty slot keeps the two sides lined up. */
function Slot({ data }: NodeProps<Node<{ width: number; height: number }>>) {
  return <div style={{ width: data.width, height: data.height }} className="rounded-2xl border border-dashed border-slate-300/80" />;
}

interface DiffEdgeData extends Record<string, unknown> {
  mark: Mark;
  dim: boolean;
  selected: boolean;
}

function DiffEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<Edge<DiffEdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  if (!data) return null;
  const emphasised = data.mark !== 'same';
  return (
    <>
      {data.selected && <path d={path} fill="none" stroke="#6366f1" strokeOpacity={0.25} strokeWidth={9} />}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: EDGE_STROKE[data.mark],
          strokeWidth: emphasised ? 2.5 : 1.5,
          strokeDasharray: data.mark === 'removed' ? '6 5' : undefined,
          opacity: data.dim && data.mark === 'same' ? 0.25 : 1,
        }}
      />
    </>
  );
}

const types: NodeTypes = {
  start: framed(cardTypes.start) as never,
  tool: framed(cardTypes.tool) as never,
  end: framed(cardTypes.end) as never,
  slot: Slot as never,
};
const edgeTypes = { diff: DiffEdge };

export type PaneInstance = ReactFlowInstance;

interface Props {
  doc: GraphDoc;
  /** The other version: steps that only it has leave an empty slot here. */
  other: GraphDoc;
  positions: Record<string, Position>;
  nodeMarks: Map<string, Mark>;
  edgeMarks: Map<string, Mark>;
  toolsByName: Map<string, ToolDefinition>;
  selectedNode: string | null;
  selectedEdge: string | null;
  onlyChanges: boolean;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClear: () => void;
  onInit: (rf: PaneInstance) => void;
  /** A move the person made, to carry over to the other side. */
  onMove: (viewport: Viewport) => void;
}

/** One side of a comparison: a read-only canvas of one version, drawn with the same cards as the editor. */
export function ComparePane(props: Props) {
  const { doc, other, positions, nodeMarks, edgeMarks, toolsByName, selectedNode, selectedEdge, onlyChanges } = props;

  const { nodes, edges } = useMemo(() => {
    const own = new Set(doc.nodes.map((n) => n.id));
    const types = new Map(doc.nodes.map((n) => [n.id, n.type]));
    const centre = (id: string) => (positions[id]?.x ?? 0) + nodeSize(types.get(id) ?? 'tool').width / 2;
    const outs = new Map<string, typeof doc.edges>();
    for (const e of doc.edges) outs.set(e.source, [...(outs.get(e.source) ?? []), e]);

    const rowsOf = (id: string): BranchRow[] | undefined => {
      const list = outs.get(id);
      if (!list || list.length < 2) return undefined;
      return [...list]
        .sort((a, b) => Number(a.isDefault) - Number(b.isDefault) || centre(a.target) - centre(b.target))
        .map((e) => {
          const mark = edgeMarks.get(e.id) ?? 'same';
          return {
            edgeId: e.id,
            text: e.condition || (e.isDefault ? 'Otherwise' : 'Needs a condition'),
            kind: e.condition ? 'if' : e.isDefault ? 'else' : 'missing',
            side: centre(e.target) < centre(id) - 8 ? 'left' : 'right',
            // The card draws these three states; compare.css gives the "selected" look to a changed row.
            state: mark === 'added' ? 'trace' : mark === 'removed' ? 'invalid' : mark === 'changed' ? 'selected' : undefined,
          } satisfies BranchRow;
        });
    };

    const cards = doc.nodes.map((node: FlowNode): Node<DiffData> => {
      const mark = nodeMarks.get(node.id) ?? 'same';
      return {
        id: node.id,
        type: node.type,
        position: positions[node.id]!,
        draggable: false,
        connectable: false,
        selected: node.id === selectedNode,
        data: {
          node,
          tool: node.tool ? toolsByName.get(node.tool.name) : undefined,
          issues: [],
          branches: rowsOf(node.id),
          onPickEdge: props.onSelectEdge,
          mark,
          dim: onlyChanges,
        },
      };
    });

    const slots = other.nodes
      .filter((n) => !own.has(n.id))
      .map((n): Node<{ width: number; height: number }> => ({
        id: `slot:${n.id}`,
        type: 'slot',
        position: positions[n.id]!,
        draggable: false,
        selectable: false,
        connectable: false,
        data: { width: nodeSize(n.type).width, height: nodeHeight(n, other.edges.filter((e) => e.source === n.id).length) },
      }));

    const links = doc.edges.map((e): Edge<DiffEdgeData> => {
      const mark = edgeMarks.get(e.id) ?? 'same';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (outs.get(e.source)?.length ?? 0) > 1 ? e.id : OUT_HANDLE,
        type: 'diff',
        selectable: true,
        data: { mark, dim: onlyChanges, selected: e.id === selectedEdge },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STROKE[mark], width: 14, height: 14 },
      };
    });
    return { nodes: [...cards, ...slots] as Node[], edges: links as Edge[] };
  }, [doc, other, positions, nodeMarks, edgeMarks, toolsByName, selectedNode, selectedEdge, onlyChanges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={types}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesReconnectable={false}
      deleteKeyCode={null}
      onInit={props.onInit}
      onNodeClick={(_, n) => !n.id.startsWith('slot:') && props.onSelectNode(n.id)}
      onEdgeClick={(_, e) => props.onSelectEdge(e.id)}
      onPaneClick={props.onClear}
      onMove={(event, viewport) => event && props.onMove(viewport)}
      proOptions={{ hideAttribution: true }}
      panOnScroll
      minZoom={0.08}
      maxZoom={1.75}
      className="af-canvas af-compare"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
    </ReactFlow>
  );
}
