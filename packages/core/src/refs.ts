/**
 * References inside argsHint and instructions:
 *   {{input.ticket_id}}         a run input
 *   {{new_user.id}}             a field of the result saved by a step's outputKey
 *   {{queues[2].name}}          array index
 * Everything else in a hint is free text for the agent.
 */
export const INPUT_ROOT = 'input';

export interface Ref {
  raw: string;
  root: string;
  path: string[];
}

const REF = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_-]+|\[\d+\])*)\s*\}\}/g;

export function parseRefs(text: string): Ref[] {
  return [...text.matchAll(REF)].map((m) => ({
    raw: m[0],
    root: m[1]!,
    path: [...m[2]!.matchAll(/\.([A-Za-z0-9_-]+)|\[(\d+)\]/g)].map((p) => p[1] ?? p[2]!),
  }));
}

/** A hint that is exactly one reference, e.g. "{{new_user.id}}". */
export function soleRef(text: string): Ref | null {
  const refs = parseRefs(text);
  return refs.length === 1 && refs[0]!.raw === text.trim() ? refs[0]! : null;
}

/** Looks a reference up in the run; undefined when any part of the path is missing. */
export function resolveRef(ref: Ref, inputs: Record<string, unknown>, context: Record<string, unknown>): unknown {
  let value: unknown = ref.root === INPUT_ROOT ? inputs : context[ref.root];
  for (const key of ref.path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
