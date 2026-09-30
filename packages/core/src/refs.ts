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

export type Lookup = { found: true; value: unknown } | { found: false; reason: string };

/** Looks a reference up in the run and, when it is missing, says where the path broke and what exists there. */
export function lookupRef(ref: Ref, inputs: Record<string, unknown>, context: Record<string, unknown>): Lookup {
  if (ref.root !== INPUT_ROOT && !(ref.root in context)) {
    return { found: false, reason: `no result "${ref.root}" yet: the step that saves it has not run or did not succeed` };
  }
  let value: unknown = ref.root === INPUT_ROOT ? inputs : context[ref.root];
  let at = ref.root;
  for (const key of ref.path) {
    if (value === null || typeof value !== 'object' || !(key in value)) {
      const fields = value !== null && typeof value === 'object' ? Object.keys(value) : [];
      return { found: false, reason: `"${at}" has no field "${key}"${fields.length ? `; it has: ${fields.join(', ')}` : ''}` };
    }
    value = (value as Record<string, unknown>)[key];
    at += `.${key}`;
  }
  return { found: true, value };
}

/** The value of a reference, or undefined when it cannot be found. */
export function resolveRef(ref: Ref, inputs: Record<string, unknown>, context: Record<string, unknown>): unknown {
  const lookup = lookupRef(ref, inputs, context);
  return lookup.found ? lookup.value : undefined;
}

export interface Unresolved {
  ref: string;
  reason: string;
}

/** Replaces every reference in `text` with its value; references that cannot be found stay as they are and are reported. */
export function interpolate(text: string, inputs: Record<string, unknown>, context: Record<string, unknown>): { text: string; unresolved: Unresolved[] } {
  const unresolved: Unresolved[] = [];
  const filled = text.replace(REF, (raw) => {
    const [ref] = parseRefs(raw);
    const lookup = lookupRef(ref!, inputs, context);
    if (!lookup.found) {
      unresolved.push({ ref: raw, reason: lookup.reason });
      return raw;
    }
    return typeof lookup.value === 'string' ? lookup.value : JSON.stringify(lookup.value);
  });
  return { text: filled, unresolved };
}
