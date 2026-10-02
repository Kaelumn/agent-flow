import type { GraphDoc } from '@agent-flow/core';
import { errorJumps } from './layout';

export interface AvailableRef {
  /** Text to insert, e.g. "{{input.ticket_id}}" or "{{new_user.}}". */
  ref: string;
  /** How far before the end of `ref` to leave the caret: results still need a field name. */
  caretBack: number;
  label: string;
  source: string;
}

/** Data a node may reference: run inputs, and results saved by steps that can run before it. */
export function availableRefs(doc: GraphDoc, nodeId: string): AvailableRef[] {
  const links = [...doc.edges, ...errorJumps(doc.nodes)];
  const before = new Set<string>();
  const stack = links.filter((e) => e.target === nodeId).map((e) => e.source);
  while (stack.length) {
    const id = stack.pop()!;
    if (before.has(id) || id === nodeId) continue;
    before.add(id);
    stack.push(...links.filter((e) => e.target === id).map((e) => e.source));
  }

  const start = doc.nodes.find((n) => n.type === 'start');
  const inputs = (start?.inputs ?? []).map((i) => ({ ref: `{{input.${i.name}}}`, caretBack: 0, label: i.name, source: 'Run input' }));
  // A step's listed output fields come first; the bare key still lets you name any other field.
  const results = doc.nodes
    .filter((n) => before.has(n.id) && n.outputKey)
    .flatMap((n) => [
      ...(n.outputs ?? []).map((f) => ({ ref: `{{${n.outputKey}.${f.name}}}`, caretBack: 0, label: `${n.outputKey}.${f.name}`, source: f.description || n.title })),
      { ref: `{{${n.outputKey}.}}`, caretBack: 2, label: n.outputKey!, source: n.title },
    ]);
  return [...inputs, ...results];
}
