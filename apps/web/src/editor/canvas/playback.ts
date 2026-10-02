import { stableStringify, type GraphDoc } from '@agent-flow/core';

export interface DocDiff {
  addedNodes: string[];
  addedEdges: string[];
  removedNodes: string[];
  removedEdges: string[];
  /** Same id, different content; moves alone do not count. */
  changedNodes: string[];
  changedEdges: string[];
}

export type Beat = { kind: 'node' | 'edge'; id: string };

const content = ({ position: _, ...rest }: { position?: unknown }) => stableStringify(rest);

export function diffDocs(from: GraphDoc, to: GraphDoc): DocDiff {
  const before = { nodes: new Map(from.nodes.map((n) => [n.id, n])), edges: new Map(from.edges.map((e) => [e.id, e])) };
  const after = { nodes: new Set(to.nodes.map((n) => n.id)), edges: new Set(to.edges.map((e) => e.id)) };
  return {
    addedNodes: to.nodes.filter((n) => !before.nodes.has(n.id)).map((n) => n.id),
    addedEdges: to.edges.filter((e) => !before.edges.has(e.id)).map((e) => e.id),
    removedNodes: from.nodes.filter((n) => !after.nodes.has(n.id)).map((n) => n.id),
    removedEdges: from.edges.filter((e) => !after.edges.has(e.id)).map((e) => e.id),
    changedNodes: to.nodes.filter((n) => before.nodes.has(n.id) && content(before.nodes.get(n.id)!) !== content(n)).map((n) => n.id),
    changedEdges: to.edges.filter((e) => before.edges.has(e.id) && stableStringify(before.edges.get(e.id)) !== stableStringify(e)).map((e) => e.id),
  };
}

export const isEmpty = (d: DocDiff) => Object.values(d).every((ids) => !ids.length);

/**
 * The order in which new and redrawn elements appear: nodes in flow order from the start node,
 * each edge as soon as both of its ends are on screen. A batch of additions then reads as the flow growing.
 */
export function schedule(to: GraphDoc, diff: DocDiff): Beat[] {
  const added = new Set(diff.addedNodes);
  const visible = new Set(to.nodes.filter((n) => !added.has(n.id)).map((n) => n.id));
  const pending = new Set([...diff.addedEdges, ...diff.changedEdges]);
  const beats: Beat[] = [];

  const releaseEdges = () => {
    for (const e of to.edges) {
      if (pending.has(e.id) && visible.has(e.source) && visible.has(e.target)) {
        pending.delete(e.id);
        beats.push({ kind: 'edge', id: e.id });
      }
    }
  };

  releaseEdges();
  for (const id of flowOrder(to)) {
    if (!added.has(id)) continue;
    beats.push({ kind: 'node', id });
    visible.add(id);
    releaseEdges();
  }
  return beats;
}

/** Breadth-first from the start node, then anything unreachable in document order. */
function flowOrder(doc: GraphDoc) {
  const next = new Map<string, string[]>();
  for (const e of doc.edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  for (const n of doc.nodes) if (n.onError?.targetNodeId) next.set(n.id, [...(next.get(n.id) ?? []), n.onError.targetNodeId]);

  const seen = new Set<string>();
  const queue = doc.nodes.filter((n) => n.type === 'start').map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(next.get(id) ?? []));
  }
  return [...seen, ...doc.nodes.map((n) => n.id).filter((id) => !seen.has(id))];
}
