import type { GraphDoc } from '@agent-flow/core';
import { describe, expect, it } from 'vitest';
import { buildMessage, describeTarget } from './message';
import { resolveTarget, type Shapes } from './targets';

// Three cards in a column joined by straight edges: a (0..100) → b (200..300) → c (400..500).
const card = (id: string, y: number) => ({ id, rect: { x: 0, y, width: 200, height: 100 } });
const line = (id: string, from: number, to: number) => ({ id, points: Array.from({ length: (to - from) / 10 + 1 }, (_, i) => ({ x: 100, y: from + i * 10 })) });
const shapes: Shapes = { nodes: [card('a', 0), card('b', 200), card('c', 400)], edges: [line('ab', 100, 200), line('bc', 300, 400)] };

describe('resolveTarget', () => {
  it('takes a box inside one card as that card', () => {
    expect(resolveTarget({ x: 20, y: 220, width: 50, height: 30 }, shapes)).toEqual({ scope: 'elements', nodeIds: ['b'], edgeIds: [] });
  });

  it('collects cards it mostly covers and the edges running between them', () => {
    expect(resolveTarget({ x: -10, y: -10, width: 220, height: 320 }, shapes)).toEqual({ scope: 'elements', nodeIds: ['a', 'b'], edgeIds: ['ab'] });
  });

  it('ignores a card it only grazes', () => {
    expect(resolveTarget({ x: 50, y: 120, width: 100, height: 100 }, shapes)).toEqual({ scope: 'elements', nodeIds: [], edgeIds: ['ab'] });
  });

  it('points at the nearest edge from empty canvas', () => {
    expect(resolveTarget({ x: 220, y: 130, width: 60, height: 40 }, shapes)).toEqual({ scope: 'near', nodeIds: [], edgeIds: ['ab'] });
  });

  it('falls back to the nearest card when no edge is close', () => {
    expect(resolveTarget({ x: 900, y: 420, width: 40, height: 40 }, shapes)).toEqual({ scope: 'near', nodeIds: ['c'], edgeIds: [] });
  });

  it('treats a box over most of a large flow as the whole flow', () => {
    const big: Shapes = { nodes: Array.from({ length: 6 }, (_, i) => card(`n${i}`, i * 200)), edges: [] };
    expect(resolveTarget({ x: -10, y: -10, width: 220, height: 1020 }, big).scope).toBe('flow');
  });
});

const doc: GraphDoc = {
  nodes: [
    { id: 'a', type: 'start', title: 'Start' },
    { id: 'b', type: 'tool', title: 'Check stock' },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', condition: 'the SKU exists' }],
} as GraphDoc;

describe('annotation message', () => {
  it('names each target by title, id and condition', () => {
    expect(describeTarget({ scope: 'elements', nodeIds: ['b'], edgeIds: ['ab'] }, doc)).toBe('step "Check stock" (b); connection "Start" → "Check stock" (edge ab, when: the SKU exists)');
    expect(describeTarget({ scope: 'near', nodeIds: [], edgeIds: ['ab'] }, doc)).toMatch(/^near connection/);
  });

  it('carries the flow revision in both the text and the payload', () => {
    const message = buildMessage({ id: 'g_1', title: 'Onboarding', revision: 17 }, doc, [
      { id: 'x', box: { x: 0, y: 0, width: 1, height: 1 }, note: 'Swap the condition', target: { scope: 'elements', nodeIds: [], edgeIds: ['ab'] } },
    ]);
    expect(message).toMatchObject({ type: 'agent-flow.annotations', version: 1, flow: { revision: 17 } });
    expect(message.annotations[0]).toEqual({ index: 1, note: 'Swap the condition', scope: 'elements', nodes: [], edges: [{ id: 'ab', source: 'a', target: 'b', condition: 'the SKU exists' }] });
    expect(message.text).toContain('1 annotation on "Onboarding" (flow g_1, draft revision 17)');
    expect(message.text).toContain('1. Swap the condition');
  });
});
