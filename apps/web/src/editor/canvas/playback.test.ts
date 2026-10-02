import type { GraphDoc } from '@agent-flow/core';
import { describe, expect, it } from 'vitest';
import { diffDocs, isEmpty, schedule } from './playback';

const doc = (nodes: [string, string?][], edges: [string, string, string][]): GraphDoc =>
  ({
    nodes: nodes.map(([id, title = id]) => ({ id, type: id === 'start' ? 'start' : 'tool', title })),
    edges: edges.map(([id, source, target]) => ({ id, source, target })),
  }) as GraphDoc;

describe('diffDocs', () => {
  it('ignores moves and reports content changes', () => {
    const before = doc([['start'], ['a']], [['e1', 'start', 'a']]);
    const moved = { ...before, nodes: before.nodes.map((n) => ({ ...n, position: { x: 10, y: 10 } })) };
    expect(isEmpty(diffDocs(before, moved))).toBe(true);
    expect(diffDocs(before, doc([['start'], ['a', 'Renamed']], [['e1', 'start', 'a']])).changedNodes).toEqual(['a']);
  });

  it('separates additions from removals', () => {
    const d = diffDocs(doc([['start'], ['a']], [['e1', 'start', 'a']]), doc([['start'], ['b']], [['e2', 'start', 'b']]));
    expect(d).toMatchObject({ addedNodes: ['b'], removedNodes: ['a'], addedEdges: ['e2'], removedEdges: ['e1'] });
  });
});

describe('schedule', () => {
  it('grows a batch in flow order: node, edge, node, edge', () => {
    const from = doc([['start']], []);
    // Added in reverse to show that document order does not matter.
    const to = doc([['start'], ['c'], ['b'], ['a']], [['e3', 'b', 'c'], ['e2', 'a', 'b'], ['e1', 'start', 'a']]);
    expect(schedule(to, diffDocs(from, to))).toEqual([
      { kind: 'node', id: 'a' },
      { kind: 'edge', id: 'e1' },
      { kind: 'node', id: 'b' },
      { kind: 'edge', id: 'e2' },
      { kind: 'node', id: 'c' },
      { kind: 'edge', id: 'e3' },
    ]);
  });

  it('draws edges between existing nodes first, and redraws changed edges', () => {
    const from = doc([['start'], ['a']], [['e1', 'start', 'a']]);
    const to = { ...doc([['start'], ['a']], [['e1', 'start', 'a'], ['e2', 'a', 'start']]) };
    to.edges[0] = { ...to.edges[0]!, condition: 'now conditional' };
    expect(schedule(to, diffDocs(from, to))).toEqual([
      { kind: 'edge', id: 'e1' },
      { kind: 'edge', id: 'e2' },
    ]);
  });
});
