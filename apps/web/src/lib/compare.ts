import type { GraphDoc } from '@agent-flow/core';

/** Key-order-independent serialization (the database may reorder JSON keys). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Same flow, ignoring where nodes sit on the canvas. */
export const sameFlow = (a: GraphDoc, b: GraphDoc) => {
  const strip = (doc: GraphDoc) => stable({ nodes: doc.nodes.map(({ position: _, ...n }) => n), edges: doc.edges });
  return strip(a) === strip(b);
};
