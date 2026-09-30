import dagre from '@dagrejs/dagre';
import type { GraphDoc, Position } from '@agent-flow/core';

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 96;

/** Top-to-bottom layered layout of the whole flow. */
export function autoLayout(doc: GraphDoc): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of doc.nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of doc.edges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);
  return Object.fromEntries(
    doc.nodes.map((n) => {
      const { x, y } = g.node(n.id);
      return [n.id, { x: Math.round(x - NODE_WIDTH / 2), y: Math.round(y - NODE_HEIGHT / 2) }];
    }),
  );
}

/**
 * Where to draw each node. Stored positions win. If nothing is placed yet the whole flow is laid out;
 * otherwise unplaced nodes (typically added by the agent) go below their first placed predecessor.
 */
export function resolvePositions(doc: GraphDoc): Record<string, Position> {
  const placed = doc.nodes.filter((n) => n.position);
  if (placed.length === 0) return autoLayout(doc);

  const positions: Record<string, Position> = Object.fromEntries(placed.map((n) => [n.id, n.position!]));
  const taken = new Set(Object.values(positions).map(key));
  const place = (id: string, below: Position) => {
    let spot = { x: below.x, y: below.y + NODE_HEIGHT + 70 };
    while (taken.has(key(spot))) spot = { x: spot.x + NODE_WIDTH + 40, y: spot.y };
    positions[id] = spot;
    taken.add(key(spot));
  };

  let pending = doc.nodes.filter((n) => !n.position);
  let progressed = true;
  while (pending.length && progressed) {
    const before = pending.length;
    pending = pending.filter((node) => {
      const parent = doc.edges.find((e) => e.target === node.id && positions[e.source]);
      if (!parent) return true;
      place(node.id, positions[parent.source]!);
      return false;
    });
    progressed = pending.length < before;
  }
  // Nodes not connected to anything placed yet go under the lowest node.
  for (const node of pending) place(node.id, { x: 0, y: Math.max(...Object.values(positions).map((p) => p.y)) });
  return positions;
}

/** A spot below `anchor` (or below everything) that does not overlap an existing node. */
export function spotBelow(positions: Position[], anchor?: Position): Position {
  const base = anchor ?? { x: Math.min(0, ...positions.map((p) => p.x)), y: Math.max(-NODE_HEIGHT - 70, ...positions.map((p) => p.y)) };
  const overlaps = (s: Position) => positions.some((p) => Math.abs(p.x - s.x) < NODE_WIDTH + 20 && Math.abs(p.y - s.y) < NODE_HEIGHT + 20);
  let spot = { x: base.x, y: base.y + NODE_HEIGHT + 70 };
  while (overlaps(spot)) spot = { x: spot.x + NODE_WIDTH + 40, y: spot.y };
  return spot;
}

const key = (p: Position) => `${Math.round(p.x / 40)}:${Math.round(p.y / 40)}`;
