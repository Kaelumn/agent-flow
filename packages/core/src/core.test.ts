import { describe, expect, it } from 'vitest';
import { applyOps, GraphDoc, interpolate, isUnfinished, OpError, resolveRef, resolveTransition, soleRef, ToolOutcome, validateGraph, type ToolDefinition } from './index.js';

const tools: ToolDefinition[] = [
  {
    name: 'check_user',
    connector: 'test',
    description: '',
    writes: false,
    inputSchema: { type: 'object', properties: { upn: { type: 'string' } }, required: ['upn'] },
  },
];
const lookup = (name: string) => tools.find((t) => t.name === name);

let seq = 0;
const genId = (prefix: string) => `${prefix}${++seq}`;

const build = () =>
  applyOps({ nodes: [], edges: [] }, [
    {
      op: 'addNodes',
      nodes: [
        { id: 'start', type: 'start', title: 'Start' },
        { id: 'check', type: 'tool', title: 'Check', tool: { name: 'check_user', argsHint: { upn: 'from form' } }, outputKey: 'exists', onError: { strategy: 'goto', targetNodeId: 'failed' } },
        { id: 'done', type: 'end', title: 'Done' },
        { id: 'stop', type: 'end', title: 'Exists', outcome: 'stopped' },
        { id: 'failed', type: 'end', title: 'Failed', outcome: 'failed' },
      ],
    },
    {
      op: 'addEdges',
      edges: [
        { id: 'e1', source: 'start', target: 'check' },
        { id: 'e2', source: 'check', target: 'stop', condition: 'user exists' },
        { id: 'e3', source: 'check', target: 'done', isDefault: true },
      ],
    },
  ], genId).doc;

describe('validateGraph', () => {
  it('accepts a well-formed flow', () => {
    expect(validateGraph(build(), lookup)).toEqual([]);
  });

  it('reports structural problems', () => {
    const doc = applyOps(build(), [
      { op: 'addNodes', nodes: [{ id: 'orphan', type: 'tool', title: 'Orphan', tool: { name: 'nope', argsHint: {} } }] },
      { op: 'updateEdge', edgeId: 'e3', patch: { isDefault: false } },
    ], genId).doc;
    const issues = validateGraph(doc, lookup);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['dead_end', 'tool_unknown', 'unreachable', 'condition_missing']));
    // Gaps that close as building goes on are told apart from mistakes.
    expect(issues.filter((i) => !isUnfinished(i)).map((i) => i.code)).toEqual(['tool_unknown']);
  });

  it('flags unknown tool parameters', () => {
    const doc = applyOps(build(), [
      { op: 'updateNode', nodeId: 'check', patch: { tool: { name: 'check_user', argsHint: { email: 'x' } } } },
    ], genId).doc;
    const codes = validateGraph(doc, lookup).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['arg_unknown', 'arg_hint_missing']));
  });
});

describe('applyOps', () => {
  it('removes edges together with their node', () => {
    const doc = applyOps(build(), [{ op: 'removeNode', nodeId: 'check' }], genId).doc;
    expect(doc.edges.map((e) => e.id)).toEqual([]);
  });

  it('clears optional fields with null', () => {
    const doc = applyOps(build(), [{ op: 'updateNode', nodeId: 'check', patch: { onError: null } }], genId).doc;
    expect(doc.nodes.find((n) => n.id === 'check')?.onError).toBeUndefined();
  });

  it('rejects duplicate ids', () => {
    expect(() => applyOps(build(), [{ op: 'addNodes', nodes: [{ id: 'check', type: 'end', title: 'X' }] }], genId)).toThrow(OpError);
  });
});

describe('resolveTransition', () => {
  const doc: GraphDoc = build();
  const ok = { status: 'succeeded' as const, result: false };

  it('auto-selects the only outgoing edge', () => {
    expect(resolveTransition(doc, 'start', { nodeId: 'start' }).next?.id).toBe('check');
  });

  it('refuses out-of-order submissions', () => {
    expect(() => resolveTransition(doc, 'start', { nodeId: 'check', outcome: ok })).toThrow(/run is at node/);
  });

  it('requires a tool outcome and a choice at branches', () => {
    expect(() => resolveTransition(doc, 'check', { nodeId: 'check' })).toThrow(/report the tool outcome/);
    expect(() => resolveTransition(doc, 'check', { nodeId: 'check', outcome: ok })).toThrow(/choose edgeId/);
    expect(() => resolveTransition(doc, 'check', { nodeId: 'check', outcome: ok, edgeId: 'e1' })).toThrow(/does not leave/);
  });

  it('finishes with the end node outcome', () => {
    const t = resolveTransition(doc, 'check', { nodeId: 'check', outcome: ok, edgeId: 'e2' });
    expect(t.finalStatus).toBe('stopped');
  });

  it('treats a skipped tool like a failed one, and requires a reason', () => {
    const t = resolveTransition(doc, 'check', { nodeId: 'check', outcome: { status: 'skipped', error: 'no UPN in the form' } });
    expect([t.stepStatus, t.next?.id]).toEqual(['skipped', 'failed']);
    expect(ToolOutcome.safeParse({ status: 'skipped' }).success).toBe(false);
  });

  it('follows the on-error strategy', () => {
    const t = resolveTransition(doc, 'check', { nodeId: 'check', outcome: { status: 'failed', error: 'boom' } });
    expect([t.next?.id, t.finalStatus, t.edge]).toEqual(['failed', 'failed', null]);
  });
});

describe('change summaries', () => {
  it('lists only fields that actually changed', () => {
    const doc = build();
    const node = doc.nodes.find((n) => n.id === 'check')!;
    const { summary } = applyOps(doc, [{ op: 'updateNode', nodeId: 'check', patch: { title: node.title, tool: node.tool, instruction: 'new' } }], genId);
    expect(summary).toEqual(['updated node check: instruction']);
  });

  it('reports nothing for a no-op patch', () => {
    const { summary } = applyOps(build(), [{ op: 'updateEdge', edgeId: 'e2', patch: { condition: 'user exists' } }], genId);
    expect(summary).toEqual([]);
  });
});

describe('references', () => {
  const lookup2 = (name: string) =>
    ({ name, connector: 't', description: '', writes: false, inputSchema: { type: 'object' as const, properties: { upn: { type: 'string' }, id: { type: 'string' } } } });
  const doc = applyOps({ nodes: [], edges: [] }, [
    {
      op: 'addNodes',
      nodes: [
        { id: 'start', type: 'start', title: 'Start', inputs: [{ name: 'email', description: '', required: true }] },
        { id: 'find', type: 'tool', title: 'Find', tool: { name: 'find', argsHint: { upn: '{{input.email}}' } }, outputKey: 'user' },
        { id: 'extra', type: 'tool', title: 'Extra', tool: { name: 'extra', argsHint: { id: '{{user.id}}' } }, outputKey: 'extra' },
        { id: 'use', type: 'tool', title: 'Use', tool: { name: 'use', argsHint: { id: '{{user.id}}', upn: '{{extra.upn}}' } } },
        { id: 'done', type: 'end', title: 'Done' },
      ],
    },
    {
      op: 'addEdges',
      edges: [
        { source: 'start', target: 'find' },
        { source: 'find', target: 'extra', condition: 'needs extra' },
        { source: 'find', target: 'use', isDefault: true },
        { source: 'extra', target: 'use' },
        { source: 'use', target: 'done' },
      ],
    },
  ], genId).doc;

  it('accepts results produced on every path and warns about optional ones', () => {
    const issues = validateGraph(doc, lookup2);
    expect(issues.map((i) => [i.code, i.nodeId])).toEqual([['ref_maybe_unavailable', 'use']]);
  });

  it('rejects unknown inputs, unknown results and results produced later', () => {
    const broken = applyOps(doc, [
      { op: 'updateNode', nodeId: 'find', patch: { tool: { name: 'find', argsHint: { upn: '{{input.mail}}', id: '{{extra.id}}' } } } },
      { op: 'updateNode', nodeId: 'use', patch: { instruction: 'Use {{nobody.id}}' } },
    ], genId).doc;
    const codes = validateGraph(broken, lookup2).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['ref_unknown_input', 'ref_unavailable', 'ref_unknown']));
  });

  it('fills references inside text and explains the ones it cannot', () => {
    const context = { reset: { id: 'u-1', temporaryPassword: 'abc' } };
    const { text, unresolved } = interpolate('Password {{reset.password}} for {{input.email}} ({{reset.id}}), see {{later.x}}', { email: 'x@y' }, context);
    expect(text).toBe('Password {{reset.password}} for x@y (u-1), see {{later.x}}');
    expect(unresolved).toEqual([
      { ref: '{{reset.password}}', reason: '"reset" has no field "password"; it has: id, temporaryPassword' },
      { ref: '{{later.x}}', reason: 'no result "later" yet: the step that saves it has not run or did not succeed' },
    ]);
  });

  it('resolves references against the run', () => {
    expect(resolveRef(soleRef('{{user.groups[1]}}')!, {}, { user: { groups: ['a', 'b'] } })).toBe('b');
    expect(resolveRef(soleRef(' {{input.email}} ')!, { email: 'x@y' }, {})).toBe('x@y');
    expect(soleRef('{{user.id}} and more')).toBeNull();
  });
});
