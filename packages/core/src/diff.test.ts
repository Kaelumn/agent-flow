import { describe, expect, it } from 'vitest';
import { diffGraphs, isEmptyDiff, marksOf } from './diff.js';
import type { FlowNode, GraphDoc } from './model.js';

const step = (id: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, type: 'tool', title: id, instruction: '', ...extra });
const edge = (id: string, source: string, target: string, extra = {}) => ({ id, source, target, condition: '', isDefault: false, ...extra });

const v7: GraphDoc = {
  nodes: [{ id: 'start', type: 'start', title: 'Start', instruction: '' }, step('a'), step('b', { instruction: 'check it' }), step('c'), { id: 'end', type: 'end', title: 'End', instruction: '', outcome: 'completed' }],
  edges: [edge('e1', 'start', 'a'), edge('e2', 'a', 'b', { condition: 'ready' }), edge('e3', 'a', 'c', { isDefault: true }), edge('e4', 'b', 'end'), edge('e5', 'c', 'end')],
};

describe('diffGraphs', () => {
  it('finds nothing in identical flows, and ignores moves', () => {
    const moved = { ...v7, nodes: v7.nodes.map((n, i) => ({ ...n, position: { x: i, y: i } })) };
    const diff = diffGraphs(v7, moved);
    expect(isEmptyDiff(diff)).toBe(true);
    const again = diffGraphs(moved, { ...moved, nodes: moved.nodes.map((n) => ({ ...n, position: { x: 100, y: 100 } })) });
    expect(again.movedNodes).toBe(v7.nodes.length);
  });

  it('treats absent and default values as equal', () => {
    const noisy = { ...v7, nodes: v7.nodes.map((n) => (n.type === 'tool' ? { ...n, outputs: [], onError: { strategy: 'stop' as const } } : n)) };
    expect(isEmptyDiff(diffGraphs(v7, noisy))).toBe(true);
  });

  it('reports added, removed and changed steps with the fields that differ', () => {
    const v8: GraphDoc = {
      nodes: [...v7.nodes.filter((n) => n.id !== 'c').map((n) => (n.id === 'b' ? { ...n, instruction: 'check it twice', skill: { name: 'triage' } } : n)), step('d')],
      edges: v7.edges,
    };
    const { nodes } = diffGraphs(v7, v8);
    expect(nodes.map((n) => [n.kind, n.nodeId])).toEqual(expect.arrayContaining([['added', 'd'], ['removed', 'c'], ['changed', 'b']]));
    const b = nodes.find((n) => n.nodeId === 'b')!;
    expect(b.fields.map((f) => f.field).sort()).toEqual(['instruction', 'skill']);
  });

  it('reports a rewired connection and a changed condition', () => {
    const v8: GraphDoc = {
      ...v7,
      edges: v7.edges.map((e) => (e.id === 'e2' ? { ...e, condition: 'ready and owned' } : e.id === 'e4' ? { ...e, target: 'c' } : e)),
    };
    const { edges } = diffGraphs(v7, v8);
    expect(edges.find((e) => e.beforeId === 'e2')!.fields.map((f) => f.field)).toEqual(['condition']);
    expect(edges.find((e) => e.beforeId === 'e4')!.fields.map((f) => f.field)).toEqual(['target']);
  });

  it('matches a recreated connection by its two steps, and lists it only when something differs', () => {
    const same = { ...v7, edges: v7.edges.map((e) => (e.id === 'e4' ? { ...e, id: 'x9' } : e)) };
    expect(isEmptyDiff(diffGraphs(v7, same))).toBe(true);
    const changed = { ...v7, edges: v7.edges.map((e) => (e.id === 'e2' ? { ...e, id: 'x9', condition: 'other' } : e)) };
    const [only] = diffGraphs(v7, changed).edges;
    expect([only!.kind, only!.beforeId, only!.afterId]).toEqual(['changed', 'e2', 'x9']);
  });

  it('marks each side for drawing', () => {
    const v8: GraphDoc = { nodes: [...v7.nodes, step('d')], edges: [...v7.edges, edge('e6', 'b', 'd', { condition: 'x' })] };
    const marks = marksOf(v7, v8, diffGraphs(v7, v8));
    expect(marks.after.nodes.get('d')).toBe('added');
    expect(marks.before.nodes.has('d')).toBe(false);
    expect(marks.after.edges.get('e6')).toBe('added');
    expect(marks.before.nodes.get('a')).toBe('same');
  });
});
