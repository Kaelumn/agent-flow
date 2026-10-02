import dagre from '@dagrejs/dagre';
import type { FlowNode, GraphDoc, NodeType, Position } from '@agent-flow/core';

const SIZES: Record<NodeType, { width: number; height: number }> = {
  tool: { width: 296, height: 92 },
  start: { width: 248, height: 64 },
  end: { width: 248, height: 56 },
};

export const nodeSize = (type: NodeType) => SIZES[type];
/** The widest and tallest node, used for spacing new nodes. */
export const NODE_WIDTH = SIZES.tool.width;
export const NODE_HEIGHT = SIZES.tool.height;

const GAP_X = 56;
const GAP_Y = 72;
/** The canvas snaps to this grid; layout positions sit on it too, so nodes it centres can be moved and stay centred. */
export const GRID = 8;
/** A dragged node this close (flow px) to centring on a connected node snaps into line with it. */
const ALIGN_DISTANCE = 10;

const onGrid = (v: number) => Math.round(v / GRID) * GRID;

/** Error jumps are transitions too, so failure handling lays out below the step that fails. */
export const errorJumps = (nodes: FlowNode[]) =>
  nodes.flatMap((n) => (n.type === 'tool' && n.onError?.strategy === 'goto' && n.onError.targetNodeId ? [{ source: n.id, target: n.onError.targetNodeId }] : []));

/** Top-to-bottom layered layout of the whole flow; positions are top-left corners. */
export function autoLayout(doc: GraphDoc): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: GAP_X, ranksep: GAP_Y, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  // dagre writes x/y onto the label it is given, so every node needs its own object.
  for (const node of doc.nodes) g.setNode(node.id, { ...nodeSize(node.type) });
  for (const edge of doc.edges) g.setEdge(edge.source, edge.target, { weight: 2 });
  const jumps = errorJumps(doc.nodes);
  for (const jump of jumps) if (!g.hasEdge(jump.source, jump.target)) g.setEdge(jump.source, jump.target, { weight: 1 });
  // Unconnected end nodes belong below the start, not beside it (e.g. a brand-new flow).
  const start = doc.nodes.find((n) => n.type === 'start');
  const reached = new Set([...doc.edges, ...jumps].map((e) => e.target));
  for (const end of doc.nodes.filter((n) => n.type === 'end' && !reached.has(n.id))) {
    if (start) g.setEdge(start.id, end.id, { weight: 0, minlen: 2 });
  }
  dagre.layout(g);
  return Object.fromEntries(
    doc.nodes.map((n) => {
      const { x, y } = g.node(n.id);
      const { width, height } = nodeSize(n.type);
      // Every node's half-width is the same distance off the grid, so nodes sharing a centre still share it after snapping.
      return [n.id, { x: onGrid(x - width / 2), y: onGrid(y - height / 2) }];
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
  const links = [...doc.edges, ...errorJumps(doc.nodes)];
  let pending = doc.nodes.filter((n) => !n.position);
  let progressed = true;
  while (pending.length && progressed) {
    const before = pending.length;
    pending = pending.filter((node) => {
      const parent = links.find((e) => e.target === node.id && positions[e.source]);
      if (!parent) return true;
      positions[node.id] = spotBelow(Object.values(positions), positions[parent.source]);
      return false;
    });
    progressed = pending.length < before;
  }
  // Nodes not connected to anything placed yet go under everything.
  for (const node of pending) positions[node.id] = spotBelow(Object.values(positions));
  return positions;
}

/** Where a new step goes under node `id`: centred on it, so the edge between them runs straight, and clear of others. */
export function spotAfter(doc: GraphDoc, positions: Record<string, Position>, id: string): Position {
  const node = doc.nodes.find((n) => n.id === id)!;
  const at = positions[id]!;
  const { width, height } = nodeSize(node.type);
  return spotBelow(Object.values(positions), { x: at.x + (width - NODE_WIDTH) / 2, y: at.y + height - NODE_HEIGHT });
}

/** A spot below `anchor` (or below everything) that does not overlap an existing node. */
export function spotBelow(positions: Position[], anchor?: Position): Position {
  const base = anchor ?? { x: Math.min(0, ...positions.map((p) => p.x)), y: Math.max(-NODE_HEIGHT - GAP_Y, ...positions.map((p) => p.y)) };
  const overlaps = (s: Position) => positions.some((p) => Math.abs(p.x - s.x) < NODE_WIDTH + 24 && Math.abs(p.y - s.y) < NODE_HEIGHT + 24);
  let spot = { x: base.x, y: base.y + NODE_HEIGHT + GAP_Y };
  while (overlaps(spot)) spot = { x: spot.x + NODE_WIDTH + GAP_X, y: spot.y };
  return spot;
}

/**
 * Makes room for a step inserted in front of `targetId`: the new step takes the target's spot and the target,
 * plus everything after it that sits at or below it, moves down one row.
 */
export function makeRoomBefore(doc: GraphDoc, positions: Record<string, Position>, targetId: string) {
  const links = [...doc.edges, ...errorJumps(doc.nodes)];
  const after = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const id = stack.pop()!;
    if (after.has(id)) continue;
    after.add(id);
    stack.push(...links.filter((e) => e.source === id).map((e) => e.target));
  }
  const top = positions[targetId]!;
  const shift = NODE_HEIGHT + GAP_Y;
  const moved = Object.fromEntries([...after].filter((id) => positions[id]!.y >= top.y).map((id) => [id, { x: positions[id]!.x, y: positions[id]!.y + shift }]));
  const { width } = nodeSize('tool');
  const target = doc.nodes.find((n) => n.id === targetId)!;
  const spot = { x: Math.round(top.x + (nodeSize(target.type).width - width) / 2), y: top.y };
  return { spot, moved };
}

/**
 * Where a dragged node lands: when its centre is within a few pixels of a connected node's centre, exactly in line
 * with it, so the edge between them runs straight. Nodes of different widths could not line up on the grid otherwise.
 */
export function alignToNeighbours(doc: GraphDoc, id: string, at: Position, positions: Record<string, Position>): Position {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return at;
  const half = nodeSize(node.type).width / 2;
  const centre = at.x + half;
  const neighbours = [...doc.edges, ...errorJumps(doc.nodes)].flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : []));
  let best: number | null = null;
  for (const other of doc.nodes) {
    const p = positions[other.id];
    if (!p || !neighbours.includes(other.id)) continue;
    const c = p.x + nodeSize(other.type).width / 2;
    if (Math.abs(c - centre) <= ALIGN_DISTANCE && (best === null || Math.abs(c - centre) < Math.abs(best - centre))) best = c;
  }
  return best === null ? at : { x: best - half, y: at.y };
}
