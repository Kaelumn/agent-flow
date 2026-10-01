import { z } from 'zod';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const Id = z.string().regex(ID_PATTERN, 'id must be 1-64 chars of letters, digits, "_" or "-"');

export const NodeType = z.enum(['start', 'tool', 'end']);
export type NodeType = z.infer<typeof NodeType>;

export const EndOutcome = z.enum(['completed', 'stopped', 'failed']);
export type EndOutcome = z.infer<typeof EndOutcome>;

export const Position = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof Position>;

export const InputParam = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  required: z.boolean().default(true),
});
export type InputParam = z.infer<typeof InputParam>;

export const ToolBinding = z.object({
  name: z.string().min(1),
  /** Parameter name → where the agent should take the value from. */
  argsHint: z.record(z.string(), z.string()).default({}),
});
export type ToolBinding = z.infer<typeof ToolBinding>;

export const OnError = z.object({
  strategy: z.enum(['stop', 'continue', 'goto']),
  targetNodeId: Id.optional(),
});
export type OnError = z.infer<typeof OnError>;

export const FlowNode = z.object({
  id: Id,
  type: NodeType,
  title: z.string().min(1).max(120),
  /** Guidance shown to the agent when it reaches this node. */
  instruction: z.string().default(''),
  /** start only: parameters the run must be started with. */
  inputs: z.array(InputParam).optional(),
  /** tool only. */
  tool: ToolBinding.optional(),
  /** tool only: key under which the tool result is stored in the run context. */
  outputKey: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  /** tool only: defaults to stop. */
  onError: OnError.optional(),
  /** end only: final run status. */
  outcome: EndOutcome.optional(),
  position: Position.optional(),
});
export type FlowNode = z.infer<typeof FlowNode>;

export const FlowEdge = z.object({
  id: Id,
  source: Id,
  target: Id,
  /** Natural-language condition the agent evaluates. */
  condition: z.string().default(''),
  isDefault: z.boolean().default(false),
});
export type FlowEdge = z.infer<typeof FlowEdge>;

export const GraphDoc = z.object({
  nodes: z.array(FlowNode),
  edges: z.array(FlowEdge),
});
export type GraphDoc = z.infer<typeof GraphDoc>;

export interface GraphSummary {
  id: string;
  title: string;
  description: string;
  revision: number;
  latestVersion: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Graph extends GraphSummary {
  draft: GraphDoc;
}

export interface GraphVersion {
  graphId: string;
  version: number;
  doc: GraphDoc;
  note: string;
  createdBy: string;
  createdAt: number;
}

export interface GraphEvent {
  id: string;
  graphId: string;
  revision: number;
  actor: string;
  /** Channel of the change: "web" (canvas) or "mcp" (agent). */
  source: string;
  summary: string[];
  createdAt: number;
}
