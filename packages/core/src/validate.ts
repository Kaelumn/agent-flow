import type { FlowEdge, FlowNode, GraphDoc } from './model.js';
import type { ToolLookup } from './tools.js';

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');

export function validateGraph(doc: GraphDoc, lookupTool: ToolLookup): Issue[] {
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

    if (node.type === 'tool') validateToolNode(node, lookupTool, nodes, error, warn);
    else if (node.tool || node.outputKey || node.onError) warn('tool_fields_ignored', `tool settings on ${node.type} node "${node.title}" are ignored`, ref);

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
  }

  return issues;
}

function validateToolNode(
  node: FlowNode,
  lookupTool: ToolLookup,
  nodes: Map<string, FlowNode>,
  error: (code: string, message: string, ref?: Pick<Issue, 'nodeId'>) => void,
  warn: (code: string, message: string, ref?: Pick<Issue, 'nodeId'>) => void,
) {
  const ref = { nodeId: node.id };
  if (!node.tool) {
    error('tool_missing', `"${node.title}" has no tool bound`, ref);
  } else {
    const def = lookupTool(node.tool.name);
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
    else if (target === node.id) error('on_error_target', `"${node.title}" cannot jump to itself on error`, ref);
  }
}

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
