import type { FlowEdge, FlowNode, GraphDoc } from './model.js';

/** The node fields a person edits. Positions are left out: moving a node is not a change to the flow. */
export const NODE_FIELDS = ['type', 'title', 'instruction', 'inputs', 'tool', 'skill', 'outputKey', 'outputs', 'onError', 'outcome'] as const;
export type NodeField = (typeof NODE_FIELDS)[number];

export const EDGE_FIELDS = ['source', 'target', 'condition', 'isDefault'] as const;
export type EdgeField = (typeof EDGE_FIELDS)[number];

export interface FieldChange<F extends string = string> {
  field: F;
  before: unknown;
  after: unknown;
}

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface NodeChange {
  kind: ChangeKind;
  nodeId: string;
  /** The node as it is after the change, or before it for a removed node. */
  node: FlowNode;
  /** Only for kind "changed". */
  fields: FieldChange<NodeField>[];
}

export interface EdgeChange {
  kind: ChangeKind;
  /** Ids in each version; they differ when an edge was recreated between the same two steps. */
  beforeId?: string;
  afterId?: string;
  before?: FlowEdge;
  after?: FlowEdge;
  /** Only for kind "changed". */
  fields: FieldChange<EdgeField>[];
}

export interface GraphDiff {
  nodes: NodeChange[];
  edges: EdgeChange[];
  /** Nodes present in both versions that only moved. */
  movedNodes: number;
}

export const isEmptyDiff = (diff: GraphDiff) => diff.nodes.length === 0 && diff.edges.length === 0;

const clean = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, clean(x)]),
    );
  }
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

/** What a field means when it is absent, so "no outputs" and "an empty list" do not count as a change. */
function valueOf(node: FlowNode, field: NodeField): unknown {
  const v = node[field];
  switch (field) {
    case 'inputs':
    case 'outputs':
      return v ?? [];
    case 'onError':
      return v && (v as NonNullable<FlowNode['onError']>).strategy !== 'stop' ? v : null;
    case 'outputKey':
    case 'tool':
    case 'skill':
      return v ?? null;
    case 'outcome':
      return node.type === 'end' ? (v ?? 'completed') : null;
    default:
      return v ?? '';
  }
}

function diffNode(before: FlowNode, after: FlowNode): FieldChange<NodeField>[] {
  return NODE_FIELDS.flatMap((field) => {
    const a = valueOf(before, field);
    const b = valueOf(after, field);
    return same(a, b) ? [] : [{ field, before: a, after: b }];
  });
}

function diffEdge(before: FlowEdge, after: FlowEdge): FieldChange<EdgeField>[] {
  return EDGE_FIELDS.flatMap((field) => (same(before[field], after[field]) ? [] : [{ field, before: before[field], after: after[field] }]));
}

const pair = (e: FlowEdge) => `${e.source}\u0000${e.target}`;

/**
 * What changed from `before` to `after`. Steps and connections are matched by id; a connection that was deleted and
 * recreated with a new id between the same two steps still counts as the same connection.
 */
export function diffGraphs(before: GraphDoc, after: GraphDoc): GraphDiff {
  const oldNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const newNodes = new Map(after.nodes.map((n) => [n.id, n]));

  const nodes: NodeChange[] = [];
  let movedNodes = 0;
  for (const node of after.nodes) {
    const old = oldNodes.get(node.id);
    if (!old) {
      nodes.push({ kind: 'added', nodeId: node.id, node, fields: [] });
      continue;
    }
    const fields = diffNode(old, node);
    if (fields.length) nodes.push({ kind: 'changed', nodeId: node.id, node, fields });
    else if (old.position && node.position && (old.position.x !== node.position.x || old.position.y !== node.position.y)) movedNodes++;
  }
  for (const node of before.nodes) if (!newNodes.has(node.id)) nodes.push({ kind: 'removed', nodeId: node.id, node, fields: [] });

  const oldEdges = new Map(before.edges.map((e) => [e.id, e]));
  const newEdges = new Map(after.edges.map((e) => [e.id, e]));
  const edges: EdgeChange[] = [];
  const goneEdges = before.edges.filter((e) => !newEdges.has(e.id));
  const freshEdges: FlowEdge[] = [];

  for (const edge of after.edges) {
    const old = oldEdges.get(edge.id);
    if (!old) freshEdges.push(edge);
    else {
      const fields = diffEdge(old, edge);
      if (fields.length) edges.push({ kind: 'changed', beforeId: old.id, afterId: edge.id, before: old, after: edge, fields });
    }
  }
  // Recreated connections: the same two steps, a different id.
  const unmatched = [...goneEdges];
  for (const edge of freshEdges) {
    const at = unmatched.findIndex((e) => pair(e) === pair(edge));
    if (at < 0) {
      edges.push({ kind: 'added', afterId: edge.id, after: edge, fields: [] });
      continue;
    }
    const [old] = unmatched.splice(at, 1);
    const fields = diffEdge(old!, edge);
    // A recreated connection with nothing else different is not a change worth listing.
    if (fields.length) edges.push({ kind: 'changed', beforeId: old!.id, afterId: edge.id, before: old, after: edge, fields });
  }
  for (const edge of unmatched) edges.push({ kind: 'removed', beforeId: edge.id, before: edge, fields: [] });

  return { nodes, edges, movedNodes };
}

/** How a node or connection is marked on each side of a comparison. */
export type Mark = ChangeKind | 'same';

export interface DiffMarks {
  /** Marks keyed by id in the "before" version. */
  before: { nodes: Map<string, Mark>; edges: Map<string, Mark> };
  /** Marks keyed by id in the "after" version. */
  after: { nodes: Map<string, Mark>; edges: Map<string, Mark> };
}

/** Per-version marks for drawing: removed things show on the before side, added ones on the after side. */
export function marksOf(before: GraphDoc, after: GraphDoc, diff: GraphDiff): DiffMarks {
  const marks: DiffMarks = {
    before: { nodes: new Map(before.nodes.map((n) => [n.id, 'same'])), edges: new Map(before.edges.map((e) => [e.id, 'same'])) },
    after: { nodes: new Map(after.nodes.map((n) => [n.id, 'same'])), edges: new Map(after.edges.map((e) => [e.id, 'same'])) },
  };
  for (const c of diff.nodes) {
    if (c.kind !== 'added') marks.before.nodes.set(c.nodeId, c.kind);
    if (c.kind !== 'removed') marks.after.nodes.set(c.nodeId, c.kind);
  }
  for (const c of diff.edges) {
    if (c.beforeId) marks.before.edges.set(c.beforeId, c.kind);
    if (c.afterId) marks.after.edges.set(c.afterId, c.kind);
  }
  return marks;
}
