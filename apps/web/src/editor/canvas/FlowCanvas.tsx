import type { GraphDoc, Issue, Position, ToolDefinition } from '@agent-flow/core';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { resolvePositions } from '../layout';
import { EDGE_COLORS, edgeTypes, type CanvasEdge } from './edges';
import { nodeTypes, type CanvasNode, type RunMark } from './nodes';

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
  onMove: (positions: Record<string, Position>) => void;
  onDelete: (selection: NonNullable<Selection>[]) => void;
  onReady: (instance: CanvasInstance) => void;
  /** Viewing a published version: selection only. */
  readOnly?: boolean;
}

export function FlowCanvas({ doc, issues, toolsByName, openFeedbackByNode, trace, selection, onSelect, onConnect, onMove, onDelete, onReady, readOnly = false }: Props) {
  const derived = useMemo<CanvasNode[]>(() => {
    const positions = resolvePositions(doc);
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
      },
    }));
  }, [doc, issues, toolsByName, openFeedbackByNode, trace, selection]);

  // Local copy so dragging is smooth; the server copy wins whenever it changes.
  const [nodes, setNodes] = useState(derived);
  useEffect(() => setNodes(derived), [derived]);

  const edges = useMemo<CanvasEdge[]>(() => {
    const branching = new Set(doc.nodes.filter((n) => doc.edges.filter((e) => e.source === n.id).length > 1).map((n) => n.id));
    const edgeIssues = new Set(issues.filter((i) => i.edgeId && i.severity === 'error').map((i) => i.edgeId));
    return doc.edges.map((e) => {
      const selected = selection?.kind === 'edge' && selection.id === e.id;
      const tone = selected ? 'selected' : edgeIssues.has(e.id) ? 'error' : trace?.edges.has(e.id) ? 'trace' : 'normal';
      const fallback = e.isDefault && !e.condition;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'condition',
        selected,
        data: { tone, fallback, label: branching.has(e.source) ? e.condition || (e.isDefault ? 'otherwise' : 'no condition') : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[tone], width: 16, height: 16 },
      };
    });
  }, [doc, issues, trace, selection]);

  const handleNodesChange = (changes: NodeChange<CanvasNode>[]) => setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns));

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={onReady}
      onNodesChange={handleNodesChange}
      onNodeClick={(_, n) => onSelect({ kind: 'node', id: n.id })}
      onEdgeClick={(_, e) => onSelect({ kind: 'edge', id: e.id })}
      onPaneClick={() => onSelect(null)}
      onConnect={(c: Connection) => c.source && c.target && c.source !== c.target && onConnect(c.source, c.target)}
      onNodeDragStop={(_, __, dragged) => onMove(Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])))}
      onBeforeDelete={async ({ nodes: ns, edges: es }) => {
        onDelete([...ns.map((n) => ({ kind: 'node' as const, id: n.id })), ...es.map((e) => ({ kind: 'edge' as const, id: e.id }))]);
        return false;
      }}
      deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.2}
    >
      <Background gap={20} color="#e2e8f0" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'start' ? '#10b981' : n.type === 'end' ? '#f59e0b' : '#6366f1')} />
    </ReactFlow>
  );
}
