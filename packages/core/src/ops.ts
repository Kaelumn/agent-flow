import { z } from 'zod';
import { FlowEdge, FlowNode, GraphDoc, Id, Position } from './model.js';

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

export const NodeInput = FlowNode.extend({ id: Id.optional() });
export type NodeInput = z.input<typeof NodeInput>;

/** null clears an optional field. The node type cannot change: remove and re-add instead. */
export const NodePatch = z.object({
  title: FlowNode.shape.title.optional(),
  instruction: z.string().optional(),
  inputs: nullable(FlowNode.shape.inputs.unwrap()),
  tool: nullable(FlowNode.shape.tool.unwrap()),
  skill: nullable(FlowNode.shape.skill.unwrap()),
  outputKey: nullable(FlowNode.shape.outputKey.unwrap()),
  outputs: nullable(FlowNode.shape.outputs.unwrap()),
  onError: nullable(FlowNode.shape.onError.unwrap()),
  outcome: nullable(FlowNode.shape.outcome.unwrap()),
  position: nullable(Position),
});
export type NodePatch = z.input<typeof NodePatch>;

export const EdgeInput = FlowEdge.extend({ id: Id.optional() });
export type EdgeInput = z.input<typeof EdgeInput>;

export const EdgePatch = z.object({
  source: Id.optional(),
  target: Id.optional(),
  condition: z.string().optional(),
  isDefault: z.boolean().optional(),
});
export type EdgePatch = z.input<typeof EdgePatch>;

export const GraphOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNodes'), nodes: z.array(NodeInput).min(1) }),
  z.object({ op: z.literal('updateNode'), nodeId: Id, patch: NodePatch }),
  z.object({ op: z.literal('removeNode'), nodeId: Id }),
  z.object({ op: z.literal('addEdges'), edges: z.array(EdgeInput).min(1) }),
  z.object({ op: z.literal('updateEdge'), edgeId: Id, patch: EdgePatch }),
  z.object({ op: z.literal('removeEdge'), edgeId: Id }),
  z.object({ op: z.literal('moveNodes'), positions: z.record(Id, Position) }),
]);
export type GraphOp = z.input<typeof GraphOp>;

export class OpError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export interface ApplyResult {
  doc: GraphDoc;
  summary: string[];
  createdNodeIds: string[];
  createdEdgeIds: string[];
}

/** Layout-only ops do not change what the flow means. */
export const isLayoutOnly = (ops: GraphOp[]) => ops.every((o) => o.op === 'moveNodes');

export function applyOps(doc: GraphDoc, ops: GraphOp[], genId: (prefix: string) => string): ApplyResult {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const edges = new Map(doc.edges.map((e) => [e.id, e]));
  const result: ApplyResult = { doc, summary: [], createdNodeIds: [], createdEdgeIds: [] };

  const nodeOf = (id: string) => {
    const node = nodes.get(id);
    if (!node) throw new OpError('not_found', `node "${id}" does not exist`);
    return node;
  };
  const edgeOf = (id: string) => {
    const edge = edges.get(id);
    if (!edge) throw new OpError('not_found', `edge "${id}" does not exist`);
    return edge;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'addNodes':
        for (const input of op.nodes) {
          const node = FlowNode.parse({ ...input, id: input.id ?? genId('n') });
          if (nodes.has(node.id)) throw new OpError('conflict', `node "${node.id}" already exists`);
          nodes.set(node.id, node);
          result.createdNodeIds.push(node.id);
          result.summary.push(`added ${node.type} node "${node.title}" (${node.id})`);
        }
        break;

      case 'updateNode': {
        const node = nodeOf(op.nodeId);
        const next: Record<string, unknown> = { ...node };
        for (const [key, value] of Object.entries(op.patch)) {
          if (value === null) delete next[key];
          else if (value !== undefined) next[key] = value;
        }
        const updated = FlowNode.parse(next);
        const changed = changedKeys(node, updated);
        nodes.set(node.id, updated);
        if (changed.length) result.summary.push(`updated node ${node.id}: ${changed.join(', ')}`);
        break;
      }

      case 'removeNode': {
        const node = nodeOf(op.nodeId);
        nodes.delete(node.id);
        for (const edge of [...edges.values()]) {
          if (edge.source === node.id || edge.target === node.id) edges.delete(edge.id);
        }
        result.summary.push(`removed node "${node.title}" (${node.id})`);
        break;
      }

      case 'addEdges':
        for (const input of op.edges) {
          const edge = FlowEdge.parse({ ...input, id: input.id ?? genId('e') });
          if (edges.has(edge.id)) throw new OpError('conflict', `edge "${edge.id}" already exists`);
          nodeOf(edge.source);
          nodeOf(edge.target);
          edges.set(edge.id, edge);
          result.createdEdgeIds.push(edge.id);
          result.summary.push(`connected ${edge.source} → ${edge.target}${edge.condition ? ` when "${edge.condition}"` : ''}`);
        }
        break;

      case 'updateEdge': {
        const edge = edgeOf(op.edgeId);
        const next = FlowEdge.parse({ ...edge, ...stripUndefined(op.patch) });
        nodeOf(next.source);
        nodeOf(next.target);
        const changed = changedKeys(edge, next);
        edges.set(edge.id, next);
        if (changed.length) result.summary.push(`updated edge ${edge.id}: ${changed.join(', ')}`);
        break;
      }

      case 'removeEdge': {
        const edge = edgeOf(op.edgeId);
        edges.delete(edge.id);
        result.summary.push(`removed edge ${edge.source} → ${edge.target}`);
        break;
      }

      case 'moveNodes':
        // Layout is not a meaningful change, so it adds nothing to the summary.
        for (const [id, position] of Object.entries(op.positions)) {
          nodes.set(id, { ...nodeOf(id), position });
        }
        break;
    }
  }

  result.doc = { nodes: [...nodes.values()], edges: [...edges.values()] };
  return result;
}

/** Key-order-independent serialization; MySQL, for one, reorders JSON object keys on storage. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function changedKeys(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => stableStringify(a[k]) !== stableStringify(b[k]));
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
