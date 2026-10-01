/** Rectangles and points are in flow coordinates, so they do not depend on pan or zoom. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** What an annotation box points at. `near` means the box was drawn on empty canvas next to these elements. */
export interface AnnotationTarget {
  scope: 'elements' | 'near' | 'flow';
  nodeIds: string[];
  edgeIds: string[];
}

export interface Shapes {
  nodes: { id: string; rect: Rect }[];
  /** Points sampled along each rendered edge path. */
  edges: { id: string; points: Point[] }[];
}

const NODE_OVERLAP = 0.3;
const FLOW_SHARE = 0.6;
const FLOW_MIN_NODES = 4;
const NEAR_EDGE = 160;
/** Sampled points an edge needs inside the box, so a box that grazes an edge's end does not count it. */
const EDGE_POINTS = 3;

const area = (r: Rect) => r.width * r.height;
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const encloses = (outer: Rect, inner: Rect) => contains(outer, inner) && contains(outer, { x: inner.x + inner.width, y: inner.y + inner.height });
const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Distance from a point to the nearest edge of a rectangle (0 inside). */
function gap(r: Rect, p: Point) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

export function resolveTarget(box: Rect, { nodes, edges }: Shapes): AnnotationTarget {
  // A box drawn inside a single card is about that card.
  const host = nodes.find((n) => encloses(n.rect, box));
  if (host) return { scope: 'elements', nodeIds: [host.id], edgeIds: [] };

  const nodeIds = nodes.filter((n) => overlap(box, n.rect) >= area(n.rect) * NODE_OVERLAP).map((n) => n.id);
  if (nodeIds.length > FLOW_MIN_NODES && nodeIds.length >= nodes.length * FLOW_SHARE) return { scope: 'flow', nodeIds: [], edgeIds: [] };

  // Count an edge only where it runs between cards, and only if a fair part of that run is inside the box.
  const onCanvas = (p: Point) => !nodes.some((n) => contains(n.rect, p));
  const edgeIds = edges
    .filter((e) => {
      const open = e.points.filter(onCanvas);
      const inside = open.filter((p) => contains(box, p)).length;
      return inside > 0 && (inside >= EDGE_POINTS || inside * 2 >= open.length);
    })
    .map((e) => e.id);
  if (nodeIds.length || edgeIds.length) return { scope: 'elements', nodeIds, edgeIds };

  const mid = center(box);
  const nearestEdge = edges
    .map((e) => ({ id: e.id, d: Math.min(...e.points.map((p) => distance(p, mid))) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearestEdge && nearestEdge.d <= NEAR_EDGE) return { scope: 'near', nodeIds: [], edgeIds: [nearestEdge.id] };
  const nearestNode = nodes.map((n) => ({ id: n.id, d: gap(n.rect, mid) })).sort((a, b) => a.d - b.d)[0];
  return nearestNode ? { scope: 'near', nodeIds: [nearestNode.id], edgeIds: [] } : { scope: 'flow', nodeIds: [], edgeIds: [] };
}

/** The node under a point, for annotating a card with a single click. */
export const nodeAt = (p: Point, { nodes }: Shapes) => nodes.find((n) => contains(n.rect, p));
