import type { FlowEdge, FlowNode, GraphDoc, Position } from '@agent-flow/core';
import { autoLayout, nodeHeight, nodeSize } from '../editor/layout';

/**
 * One layout for both versions of a comparison, so a step that is in both sits at the same place on each side
 * and a changed connection is the only thing that differs. The stored positions of either version are ignored.
 */
export function sharedLayout(before: GraphDoc, after: GraphDoc): Record<string, Position> {
  const nodes = new Map<string, FlowNode>();
  for (const n of [...before.nodes, ...after.nodes]) nodes.set(n.id, n);
  const seen = new Set<string>();
  const edges: FlowEdge[] = [];
  for (const e of [...after.edges, ...before.edges]) {
    const key = `${e.source}\u0000${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...e, id: key });
  }
  return autoLayout({ nodes: [...nodes.values()].map((n) => ({ ...n, position: undefined })), edges });
}

/** Everything both sides draw, as one box in flow coordinates; both panes fit their view to it so they line up. */
export function boundsOf(positions: Record<string, Position>, doc: GraphDoc, other: GraphDoc) {
  const out = new Map<string, number>();
  for (const e of [...doc.edges, ...other.edges]) out.set(e.source, (out.get(e.source) ?? 0) + 1);
  const all = new Map<string, FlowNode>();
  for (const n of [...other.nodes, ...doc.nodes]) all.set(n.id, n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [id, at] of Object.entries(positions)) {
    const node = all.get(id);
    if (!node) continue;
    x0 = Math.min(x0, at.x);
    y0 = Math.min(y0, at.y);
    x1 = Math.max(x1, at.x + nodeSize(node.type).width);
    y1 = Math.max(y1, at.y + nodeHeight(node, out.get(id) ?? 0));
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}
