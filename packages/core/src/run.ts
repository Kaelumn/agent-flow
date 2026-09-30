import { z } from 'zod';
import type { FlowEdge, FlowNode, GraphDoc } from './model.js';
import { OpError } from './ops.js';

export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'cancelled';
export const isFinished = (status: RunStatus) => status !== 'running';

export interface Run {
  id: string;
  graphId: string;
  version: number;
  status: RunStatus;
  currentNodeId: string | null;
  inputs: Record<string, unknown>;
  /** Tool results keyed by each node's outputKey. */
  context: Record<string, unknown>;
  startedBy: string;
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
}

/** passed: a node without a tool. skipped: the agent could not call the tool (e.g. missing data) and said why. */
export type StepStatus = 'succeeded' | 'failed' | 'skipped' | 'passed';

export interface RunStep {
  id: string;
  runId: string;
  seq: number;
  nodeId: string;
  edgeId: string | null;
  status: StepStatus;
  toolName: string | null;
  args: Record<string, unknown> | null;
  result: unknown;
  error: string | null;
  createdAt: number;
}

export const ToolOutcome = z
  .object({
    status: z.enum(['succeeded', 'failed', 'skipped']),
    args: z.record(z.string(), z.unknown()).optional(),
    result: z.unknown().optional(),
    /** The tool's error, or why the tool was not called. */
    error: z.string().optional(),
  })
  .refine((o) => o.status === 'succeeded' || !!o.error?.trim(), { message: 'a failed or skipped outcome needs an error explaining why', path: ['error'] });
export type ToolOutcome = z.infer<typeof ToolOutcome>;

export interface Transition {
  node: FlowNode;
  edge: FlowEdge | null;
  next: FlowNode | null;
  stepStatus: StepStatus;
  /** Set when the run ends with this transition. */
  finalStatus: RunStatus | null;
}

/** Decides where a run goes after the agent reports on the current node. Throws OpError on illegal moves. */
export function resolveTransition(
  doc: GraphDoc,
  currentNodeId: string,
  submission: { nodeId: string; outcome?: ToolOutcome; edgeId?: string },
): Transition {
  if (submission.nodeId !== currentNodeId) {
    throw new OpError('conflict', `the run is at node "${currentNodeId}", not "${submission.nodeId}"`);
  }
  const node = doc.nodes.find((n) => n.id === currentNodeId);
  if (!node) throw new OpError('not_found', `node "${currentNodeId}" is not in this version`);
  if (node.type === 'end') throw new OpError('conflict', 'the run has already reached an end node');

  let stepStatus: StepStatus = 'passed';
  if (node.type === 'tool') {
    if (!submission.outcome) throw new OpError('invalid', `"${node.title}" is a tool step: report the tool outcome`);
    stepStatus = submission.outcome.status;
    // A step that could not run is handled like a failed one.
    if (stepStatus !== 'succeeded') {
      const onError = node.onError ?? { strategy: 'stop' };
      if (onError.strategy === 'stop') return { node, edge: null, next: null, stepStatus, finalStatus: 'failed' };
      if (onError.strategy === 'goto') {
        const next = doc.nodes.find((n) => n.id === onError.targetNodeId) ?? null;
        if (!next) throw new OpError('not_found', `error target "${onError.targetNodeId}" is not in this version`);
        return { node, edge: null, next, stepStatus, finalStatus: finalStatusOf(next) };
      }
    }
  } else if (submission.outcome) {
    throw new OpError('invalid', `"${node.title}" is not a tool step and takes no outcome`);
  }

  const outs = outgoingEdges(doc, node.id);
  let edge: FlowEdge | undefined;
  if (submission.edgeId) {
    edge = outs.find((e) => e.id === submission.edgeId);
    if (!edge) throw new OpError('invalid', `edge "${submission.edgeId}" does not leave "${node.title}"; choose one of: ${outs.map((e) => e.id).join(', ')}`);
  } else if (outs.length === 1) {
    edge = outs[0];
  } else {
    throw new OpError('invalid', `"${node.title}" branches: choose edgeId from ${outs.map((e) => e.id).join(', ')}`);
  }
  const next = doc.nodes.find((n) => n.id === edge!.target) ?? null;
  if (!next) throw new OpError('not_found', `edge "${edge!.id}" points to a missing node`);
  return { node, edge: edge!, next, stepStatus, finalStatus: finalStatusOf(next) };
}

export const outgoingEdges = (doc: GraphDoc, nodeId: string) => doc.edges.filter((e) => e.source === nodeId);

const finalStatusOf = (node: FlowNode): RunStatus | null => (node.type === 'end' ? (node.outcome ?? 'completed') : null);
