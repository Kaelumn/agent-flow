import type { GraphDoc } from '@agent-flow/core';
import { describe, expect, it } from 'vitest';
import { alignToNeighbours, autoLayout, GRID, nodeSize } from './layout';

// A tool step (296 wide) followed by an end node (248 wide).
const doc = {
  nodes: [
    { id: 'start', type: 'start', title: 'Start' },
    { id: 'note', type: 'tool', title: 'Write the summary note' },
    { id: 'done', type: 'end', title: 'Onboarding done', outcome: 'completed' },
    { id: 'other', type: 'end', title: 'Elsewhere', outcome: 'stopped' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'note' },
    { id: 'e2', source: 'note', target: 'done' },
  ],
} as GraphDoc;
const centre = (id: string, x: number) => x + nodeSize(doc.nodes.find((n) => n.id === id)!.type).width / 2;

describe('alignToNeighbours', () => {
  // The case from the canvas: the step sits at x = 20, off the grid, so the end node could only land 4px off centre.
  const positions = { note: { x: 20, y: 2676 }, done: { x: 40, y: 2896 }, other: { x: 600, y: 2896 } };

  it('lines a nearby node up with the connected node', () => {
    const at = alignToNeighbours(doc, 'done', { x: 40, y: 2896 }, positions);
    expect(centre('done', at.x)).toBe(centre('note', 20));
    expect(at.y).toBe(2896);
  });

  it('leaves the node alone when it is not close, or not connected', () => {
    expect(alignToNeighbours(doc, 'done', { x: 120, y: 2896 }, positions)).toEqual({ x: 120, y: 2896 });
    expect(alignToNeighbours(doc, 'other', { x: 40, y: 2896 }, positions)).toEqual({ x: 40, y: 2896 });
  });
});

describe('autoLayout', () => {
  it('puts nodes on the grid with a chain centred on one line', () => {
    const at = autoLayout({ ...doc, nodes: doc.nodes.slice(0, 3) });
    for (const p of Object.values(at)) expect([p.x % GRID, p.y % GRID]).toEqual([0, 0]);
    expect(new Set(['start', 'note', 'done'].map((id) => centre(id, at[id]!.x))).size).toBe(1);
  });
});
