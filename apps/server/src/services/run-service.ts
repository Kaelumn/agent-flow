import {
  isFinished,
  outgoingEdges,
  resolveTransition,
  type FlowNode,
  type GraphDoc,
  type Run,
  type ToolDefinition,
  type ToolOutcome,
} from '@agent-flow/core';
import type { EventBus } from '../common/event-bus.js';
import { conflict, invalid, notFound } from '../common/errors.js';
import { newId } from '../common/ids.js';
import type { Principal } from '../common/principal.js';
import type { RunRepository } from '../repositories/run-repository.js';
import type { GraphService } from './graph-service.js';
import type { ToolCatalog } from './tool-catalog.js';

export interface StepOption {
  edgeId: string;
  condition: string;
  isDefault: boolean;
  target: { id: string; title: string; type: FlowNode['type'] };
}

/** Everything the agent needs to act on the current node, and nothing else. */
export interface StepView {
  /** Title and description carry the flow's fixed parameters (e.g. who to notify). */
  flow: { title: string; description: string };
  run: Pick<Run, 'id' | 'graphId' | 'version' | 'status' | 'currentNodeId'>;
  node: Pick<FlowNode, 'id' | 'type' | 'title' | 'instruction' | 'outputKey' | 'onError'> | null;
  tool: (ToolDefinition & { argsHint: Record<string, string> }) | null;
  options: StepOption[];
  inputs: Record<string, unknown>;
  context: Record<string, unknown>;
  guide: string;
}

export interface Submission {
  nodeId: string;
  outcome?: ToolOutcome;
  edgeId?: string;
}

const VERSION_CACHE_SIZE = 256;

export class RunService {
  /** Published versions are immutable, so they are safe to cache. */
  private readonly versionCache = new Map<string, GraphDoc>();

  constructor(
    private readonly runs: RunRepository,
    private readonly graphs: GraphService,
    private readonly tools: ToolCatalog,
    private readonly events: EventBus,
  ) {}

  async start(p: Principal, graphId: string, input: { inputs: Record<string, unknown>; version?: number }): Promise<StepView> {
    const graph = await this.graphs.require(p, graphId);
    const version = input.version ?? graph.latestVersion;
    if (version === null) throw invalid(`flow "${graph.title}" has no published version; publish it before running`);
    const doc = await this.versionDoc(p, graphId, version);

    const start = doc.nodes.find((n) => n.type === 'start')!;
    const missing = (start.inputs ?? []).filter((i) => i.required && isBlank(input.inputs[i.name])).map((i) => i.name);
    if (missing.length) throw invalid(`missing required inputs: ${missing.join(', ')}`, { missing });

    const now = Date.now();
    const run: Run = {
      id: newId('run'),
      graphId,
      version,
      status: 'running',
      currentNodeId: start.id,
      inputs: input.inputs,
      context: {},
      startedBy: p.actor,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    await this.runs.insert(p.workspaceId, run);
    this.changed(p, run);

    if (outgoingEdges(doc, start.id).length === 1) return this.transition(p, run, doc, { nodeId: start.id });
    return this.view(p, run, doc);
  }

  async current(p: Principal, runId: string): Promise<StepView> {
    const run = await this.require(p, runId);
    return this.view(p, run, await this.versionDoc(p, run.graphId, run.version));
  }

  async submit(p: Principal, runId: string, submission: Submission): Promise<StepView> {
    const run = await this.require(p, runId);
    if (isFinished(run.status)) throw conflict(`the run has already ended with status "${run.status}"`);
    return this.transition(p, run, await this.versionDoc(p, run.graphId, run.version), submission);
  }

  async cancel(p: Principal, runId: string): Promise<Run> {
    const run = await this.require(p, runId);
    const now = Date.now();
    if (!(await this.runs.cancel(runId, now))) throw conflict(`the run has already ended with status "${run.status}"`);
    return this.changed(p, { ...run, status: 'cancelled', endedAt: now, updatedAt: now });
  }

  async get(p: Principal, runId: string) {
    const run = await this.require(p, runId);
    return { run, steps: await this.runs.listSteps(runId) };
  }

  async list(p: Principal, graphId: string, limit = 50) {
    await this.graphs.require(p, graphId);
    return this.runs.list(p.workspaceId, graphId, limit);
  }

  private async transition(p: Principal, run: Run, doc: GraphDoc, submission: Submission): Promise<StepView> {
    const t = resolveTransition(doc, run.currentNodeId!, submission);
    const outcome = submission.outcome;
    const context = outcome?.status === 'succeeded' && t.node.outputKey ? { ...run.context, [t.node.outputKey]: outcome.result ?? null } : run.context;
    const now = Date.now();
    const next: Run = {
      ...run,
      status: t.finalStatus ?? 'running',
      // A run stopped by a failed step stays on that step, so the trace shows where it broke.
      currentNodeId: t.next?.id ?? t.node.id,
      context,
      endedAt: t.finalStatus ? now : null,
      updatedAt: now,
    };

    await this.runs.transaction(async (repo) => {
      if (!(await repo.advance(run.id, t.node.id, next, now))) throw conflict('the run moved on in the meantime; call run_current and retry');
      await repo.insertStep({
        id: newId('st'),
        runId: run.id,
        seq: await repo.nextSeq(run.id),
        nodeId: t.node.id,
        edgeId: t.edge?.id ?? null,
        status: t.stepStatus,
        toolName: t.node.tool?.name ?? null,
        args: outcome?.args ?? null,
        result: outcome?.result,
        error: outcome?.error ?? null,
        createdAt: now,
      });
    });
    this.changed(p, next);
    return this.view(p, next, doc);
  }

  private async view(p: Principal, run: Run, doc: GraphDoc): Promise<StepView> {
    const graph = await this.graphs.require(p, run.graphId);
    const summary = { id: run.id, graphId: run.graphId, version: run.version, status: run.status, currentNodeId: run.currentNodeId };
    const node = doc.nodes.find((n) => n.id === run.currentNodeId);
    const base = { flow: { title: graph.title, description: graph.description }, run: summary, inputs: run.inputs, context: run.context };

    if (isFinished(run.status) || !node) {
      return { ...base, node: null, tool: null, options: [], guide: `The run has ended with status "${run.status}". Nothing more to do.` };
    }

    const options = outgoingEdges(doc, node.id).map((e) => {
      const target = doc.nodes.find((n) => n.id === e.target)!;
      return { edgeId: e.id, condition: e.condition, isDefault: e.isDefault, target: { id: target.id, title: target.title, type: target.type } };
    });
    const definition = node.tool ? this.tools.get(node.tool.name) : undefined;
    const tool = definition && node.tool ? { ...definition, argsHint: node.tool.argsHint } : null;
    const { id, type, title, instruction, outputKey, onError } = node;

    return { ...base, node: { id, type, title, instruction, outputKey, onError }, tool, options, guide: guideFor(node, tool, options) };
  }

  private async versionDoc(p: Principal, graphId: string, version: number): Promise<GraphDoc> {
    const key = `${graphId}@${version}`;
    const cached = this.versionCache.get(key);
    if (cached) return cached;
    const { doc } = await this.graphs.getVersion(p, graphId, version);
    if (this.versionCache.size >= VERSION_CACHE_SIZE) this.versionCache.delete(this.versionCache.keys().next().value!);
    this.versionCache.set(key, doc);
    return doc;
  }

  private async require(p: Principal, runId: string) {
    const run = await this.runs.find(p.workspaceId, runId);
    if (!run) throw notFound(`run ${runId}`);
    return run;
  }

  private changed(p: Principal, run: Run) {
    this.events.publish({ type: 'run.changed', workspaceId: p.workspaceId, graphId: run.graphId, runId: run.id, status: run.status, currentNodeId: run.currentNodeId });
    return run;
  }
}

function guideFor(node: FlowNode, tool: StepView['tool'], options: StepOption[]): string {
  const lines: string[] = [];
  if (node.type === 'tool') {
    lines.push(
      tool
        ? `Call tool "${tool.name}". Derive each argument from argsHint, the run inputs and the context.`
        : `Perform the step "${node.title}".`,
      'Call it exactly once.',
      `Then call run_submit with nodeId "${node.id}" and outcome {status: "succeeded", args, result}, {status: "failed", args, error} with the tool's error, or {status: "skipped", error} if you could not call it because data is missing (never guess).`,
    );
    const strategy = node.onError?.strategy ?? 'stop';
    lines.push(
      strategy === 'stop'
        ? 'If the tool fails, report it: the run will stop.'
        : strategy === 'goto'
          ? `If the tool fails, report it: the run jumps to node "${node.onError?.targetNodeId}".`
          : 'If the tool fails, report it and still choose the next edge: the run continues.',
    );
  } else {
    lines.push(`Call run_submit with nodeId "${node.id}" and no outcome.`);
  }
  if (options.length > 1) {
    lines.push(`Choose edgeId by the condition that holds: ${options.map((o) => `${o.edgeId} = "${o.condition || (o.isDefault ? 'otherwise' : '')}" → ${o.target.title}`).join('; ')}.`);
  } else {
    lines.push('There is only one way forward; edgeId may be omitted.');
  }
  return lines.join(' ');
}

const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && !value.trim());
