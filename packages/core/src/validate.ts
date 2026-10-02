import type { FlowEdge, FlowNode, GraphDoc } from './model.js';
import { INPUT_ROOT, parseRefs } from './refs.js';
import type { Catalog } from './tools.js';

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');

/**
 * Issues that only say the flow is not finished: steps not yet connected, or referring to steps not yet added.
 * They clear as building goes on, so edit results count them instead of listing them; they still block publishing.
 */
const UNFINISHED = new Set(['end_missing', 'dead_end', 'unreachable', 'no_path_to_end', 'condition_missing', 'on_error_target', 'ref_unknown', 'ref_unavailable', 'ref_maybe_unavailable']);
export const isUnfinished = (issue: Issue) => UNFINISHED.has(issue.code);

export function validateGraph(doc: GraphDoc, catalog: Catalog): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, ref: Pick<Issue, 'nodeId' | 'edgeId'> = {}) =>
    issues.push({ severity: 'error', code, message, ...ref });
  const warn = (code: string, message: string, ref: Pick<Issue, 'nodeId' | 'edgeId'> = {}) =>
    issues.push({ severity: 'warning', code, message, ...ref });

  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const outgoing = groupBy(doc.edges, (e) => e.source);
  const incoming = groupBy(doc.edges, (e) => e.target);

  const starts = doc.nodes.filter((n) => n.type === 'start');
  const ends = doc.nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) error('start_count', `the flow needs exactly one start node, found ${starts.length}`);
  if (ends.length === 0) error('end_missing', 'the flow needs at least one end node');

  const seenPairs = new Set<string>();
  for (const edge of doc.edges) {
    const ref = { edgeId: edge.id };
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) error('edge_dangling', `edge ${edge.id} points to a missing node`, ref);
    if (edge.source === edge.target) error('edge_self_loop', `edge ${edge.id} connects a node to itself`, ref);
    const pair = `${edge.source}->${edge.target}`;
    if (seenPairs.has(pair)) error('edge_duplicate', `more than one edge ${edge.source} → ${edge.target}`, ref);
    seenPairs.add(pair);
  }

  const outputKeys = new Map<string, string>();
  for (const node of doc.nodes) {
    const ref = { nodeId: node.id };
    const outs = outgoing.get(node.id) ?? [];

    if (node.type === 'start' && incoming.has(node.id)) error('start_incoming', 'the start node cannot have incoming edges', ref);
    if (node.type === 'end' && outs.length > 0) error('end_outgoing', `end node "${node.title}" cannot have outgoing edges`, ref);
    if (node.type !== 'end' && outs.length === 0) error('dead_end', `"${node.title}" has no outgoing edge`, ref);

    if (outs.length > 1) {
      for (const edge of outs) {
        if (!edge.isDefault && !edge.condition.trim()) {
          error('condition_missing', `edge from "${node.title}" needs a condition because the node branches`, { edgeId: edge.id });
        }
      }
      if (outs.filter((e) => e.isDefault).length > 1) error('default_multiple', `"${node.title}" has more than one default edge`, ref);
    }

    if (node.type === 'tool') validateStep(node, catalog, nodes, error, warn);
    else if (node.tool || node.skill || node.outputKey || node.outputs || node.onError) warn('tool_fields_ignored', `step settings on ${node.type} node "${node.title}" are ignored`, ref);

    if (node.outputKey) {
      const owner = outputKeys.get(node.outputKey);
      if (owner) error('output_key_duplicate', `output key "${node.outputKey}" is also used by ${owner}`, ref);
      outputKeys.set(node.outputKey, node.id);
    }
  }

  const start = starts[0];
  if (start) {
    // Error jumps are transitions too.
    const jumps = doc.nodes.flatMap((n) =>
      n.type === 'tool' && n.onError?.strategy === 'goto' && n.onError.targetNodeId ? [[n.id, n.onError.targetNodeId] as const] : [],
    );
    const successors = (id: string) => [...(outgoing.get(id) ?? []).map((e) => e.target), ...jumps.filter(([s]) => s === id).map(([, t]) => t)];
    const predecessors = (id: string) => [...(incoming.get(id) ?? []).map((e) => e.source), ...jumps.filter(([, t]) => t === id).map(([s]) => s)];
    const reachable = walk(start.id, successors);
    const canFinish = walk(ends.map((e) => e.id), predecessors);
    for (const node of doc.nodes) {
      if (!reachable.has(node.id)) error('unreachable', `"${node.title}" cannot be reached from the start node`, { nodeId: node.id });
      else if (!canFinish.has(node.id)) error('no_path_to_end', `no path leads from "${node.title}" to an end node`, { nodeId: node.id });
    }
    validateRefs(doc, start, reachable, predecessors, outputKeys, error, warn);
  }

  return issues;
}

function validateStep(
  node: FlowNode,
  catalog: Catalog,
  nodes: Map<string, FlowNode>,
  error: (code: string, message: string, ref?: Pick<Issue, 'nodeId'>) => void,
  warn: (code: string, message: string, ref?: Pick<Issue, 'nodeId'>) => void,
) {
  const ref = { nodeId: node.id };
  if (node.tool && node.skill) error('tool_and_skill', `"${node.title}" uses both a tool and a skill; choose one`, ref);
  if (node.skill && !catalog.skill(node.skill.name)) error('skill_unknown', `skill "${node.skill.name}" is not in the skill list`, ref);
  if (!node.tool && !node.skill && !node.instruction.trim()) {
    warn('instruction_missing', `"${node.title}" uses no tool or skill: say in the instruction what the agent should do`, ref);
  }
  if (node.outputs?.length && !node.outputKey) warn('outputs_without_key', `"${node.title}" lists output fields but does not save its result, so no later step can use them`, ref);

  if (node.tool) {
    const def = catalog.tool(node.tool.name);
    if (!def) {
      error('tool_unknown', `tool "${node.tool.name}" is not in the tool catalog`, ref);
    } else {
      const params = def.inputSchema.properties;
      for (const key of Object.keys(node.tool.argsHint)) {
        if (!(key in params)) error('arg_unknown', `tool "${def.name}" has no parameter "${key}"`, ref);
      }
      for (const key of def.inputSchema.required ?? []) {
        if (!node.tool.argsHint[key]?.trim()) warn('arg_hint_missing', `required parameter "${key}" of "${def.name}" has no source hint`, ref);
      }
    }
  }

  if (node.onError?.strategy === 'goto') {
    const target = node.onError.targetNodeId;
    if (!target || !nodes.has(target)) error('on_error_target', `"${node.title}" jumps to a missing node on error`, ref);
    else if (target === node.id) error('on_error_self', `"${node.title}" cannot jump to itself on error`, ref);
  }
}

/** Checks {{...}} references: the data must exist and be produced before the step that uses it. */
function validateRefs(
  doc: GraphDoc,
  start: FlowNode,
  reachable: Set<string>,
  predecessors: (id: string) => string[],
  producers: Map<string, string>,
  error: (code: string, message: string, ref?: Pick<Issue, 'nodeId'>) => void,
  warn: (code: string, message: string, ref?: Pick<Issue, 'nodeId'>) => void,
) {
  const inputNames = new Set((start.inputs ?? []).map((i) => i.name));
  const titles = new Map(doc.nodes.map((n) => [n.id, n.title]));
  const dominators = computeDominators(doc, start.id, reachable, predecessors);
  if (producers.has(INPUT_ROOT)) error('output_key_reserved', `"${INPUT_ROOT}" is reserved for run inputs and cannot be an output key`, { nodeId: producers.get(INPUT_ROOT) });

  for (const node of doc.nodes) {
    const texts = [node.instruction, ...Object.values(node.tool?.argsHint ?? {})];
    const seen = new Set<string>();
    for (const ref of texts.flatMap(parseRefs)) {
      if (seen.has(ref.raw)) continue;
      seen.add(ref.raw);
      const where = { nodeId: node.id };
      if (ref.root === INPUT_ROOT) {
        if (!ref.path[0]) error('ref_unknown_input', `${ref.raw} in "${node.title}" names no input`, where);
        else if (!inputNames.has(ref.path[0])) error('ref_unknown_input', `${ref.raw} in "${node.title}": the start node has no input "${ref.path[0]}"`, where);
        continue;
      }
      const producer = producers.get(ref.root);
      if (!producer) error('ref_unknown', `${ref.raw} in "${node.title}": no step saves its result as "${ref.root}"`, where);
      else if (producer === node.id) error('ref_self', `${ref.raw} in "${node.title}" refers to this step's own result`, where);
      else if (!reachable.has(node.id)) continue;
      else if (!ancestors(node.id, predecessors).has(producer)) error('ref_unavailable', `${ref.raw} in "${node.title}": "${titles.get(producer)}" never runs before this step`, where);
      else if (!dominators.get(node.id)?.has(producer)) warn('ref_maybe_unavailable', `${ref.raw} in "${node.title}": "${titles.get(producer)}" does not run on every path to this step`, where);
    }
  }
}

/** For each reachable node, the nodes that every path from the start passes through. */
function computeDominators(doc: GraphDoc, startId: string, reachable: Set<string>, predecessors: (id: string) => string[]) {
  const ids = doc.nodes.map((n) => n.id).filter((id) => reachable.has(id));
  const dom = new Map(ids.map((id) => [id, id === startId ? new Set([id]) : new Set(ids)]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of ids) {
      if (id === startId) continue;
      const preds = predecessors(id).filter((p) => reachable.has(p));
      const next = new Set(preds.length ? [...dom.get(preds[0]!)!].filter((d) => preds.every((p) => dom.get(p)!.has(d))) : []);
      next.add(id);
      if (next.size !== dom.get(id)!.size) {
        dom.set(id, next);
        changed = true;
      }
    }
  }
  return dom;
}

const ancestors = (id: string, predecessors: (id: string) => string[]) => walk(predecessors(id), predecessors);

function groupBy(edges: FlowEdge[], key: (e: FlowEdge) => string) {
  const map = new Map<string, FlowEdge[]>();
  for (const edge of edges) map.set(key(edge), [...(map.get(key(edge)) ?? []), edge]);
  return map;
}

function walk(from: string | string[], next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const stack = Array.isArray(from) ? [...from] : [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return seen;
}
