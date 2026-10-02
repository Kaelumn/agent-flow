import {
  applyOps,
  hasErrors,
  isLayoutOnly,
  stableStringify,
  validateGraph,
  type Graph,
  type GraphDoc,
  type GraphOp,
  type Issue,
} from '@agent-flow/core';
import type { EventBus } from '../common/event-bus.js';
import { conflict, invalid, notFound } from '../common/errors.js';
import { newElementId, newId } from '../common/ids.js';
import type { Principal } from '../common/principal.js';
import type { GraphRepository } from '../repositories/graph-repository.js';
import type { SkillCatalog } from './skill-catalog.js';
import type { ToolCatalog } from './tool-catalog.js';

export interface GraphWithIssues extends Graph {
  issues: Issue[];
}

export interface EditResult {
  graph: GraphWithIssues;
  createdNodeIds: string[];
  createdEdgeIds: string[];
}

export class GraphService {
  constructor(
    private readonly graphs: GraphRepository,
    private readonly tools: ToolCatalog,
    private readonly skills: SkillCatalog,
    private readonly events: EventBus,
  ) {}

  list(p: Principal) {
    return this.graphs.list(p.workspaceId);
  }

  async get(p: Principal, id: string): Promise<GraphWithIssues> {
    return this.withIssues(await this.require(p, id));
  }

  async create(p: Principal, input: { title: string; description?: string }): Promise<GraphWithIssues> {
    const now = Date.now();
    const graph: Graph = {
      id: newId('g'),
      title: input.title,
      description: input.description ?? '',
      revision: 1,
      latestVersion: null,
      createdAt: now,
      updatedAt: now,
      draft: {
        nodes: [
          { id: 'start', type: 'start', title: 'Start', instruction: '', inputs: [] },
          { id: 'end', type: 'end', title: 'End', instruction: '', outcome: 'completed' },
        ],
        edges: [],
      },
    };
    await this.graphs.transaction(async (repo) => {
      await repo.insert(p.workspaceId, graph);
      await repo.insertEvent({ id: newId('ev'), graphId: graph.id, revision: 1, actor: p.actor, source: p.source, summary: ['created the flow'], createdAt: now });
    });
    this.changed(p, graph);
    return this.withIssues(graph);
  }

  async updateMeta(p: Principal, id: string, meta: { title?: string; description?: string }): Promise<GraphWithIssues> {
    const graph = await this.require(p, id);
    const now = Date.now();
    await this.graphs.updateMeta(id, meta, now);
    const updated = { ...graph, ...meta, updatedAt: now };
    this.changed(p, updated);
    return this.withIssues(updated);
  }

  /** The single write path for draft changes, used by both the canvas and the agent. */
  async edit(p: Principal, id: string, ops: GraphOp[], expectedRevision?: number): Promise<EditResult> {
    const graph = await this.require(p, id);
    if (expectedRevision !== undefined && expectedRevision !== graph.revision) {
      throw conflict(`the flow changed since revision ${expectedRevision}; it is now at revision ${graph.revision}. Re-read it and retry.`, { revision: graph.revision });
    }
    const applied = applyOps(graph.draft, ops, newElementId);
    const layoutOnly = isLayoutOnly(ops);
    if (!layoutOnly && !applied.summary.length) return { graph: this.withIssues(graph), createdNodeIds: [], createdEdgeIds: [] };
    const updated = await this.commitDraft(p, graph, applied.doc, layoutOnly ? null : applied.summary);
    return { graph: this.withIssues(updated), createdNodeIds: applied.createdNodeIds, createdEdgeIds: applied.createdEdgeIds };
  }

  async validate(p: Principal, id: string): Promise<Issue[]> {
    return this.check((await this.require(p, id)).draft);
  }

  async publish(p: Principal, id: string, note: string) {
    const graph = await this.require(p, id);
    const issues = this.check(graph.draft);
    if (hasErrors(issues)) throw invalid('the flow has errors and cannot be published', issues);

    if (graph.latestVersion !== null) {
      const latest = await this.graphs.findVersion(id, graph.latestVersion);
      if (latest && sameFlow(latest.doc, graph.draft)) throw conflict(`the draft is identical to version ${graph.latestVersion}`);
    }

    const version = { graphId: id, version: (graph.latestVersion ?? 0) + 1, doc: graph.draft, note, createdBy: p.actor, createdAt: Date.now() };
    await this.graphs.transaction(async (repo) => {
      await repo.insertVersion(version);
      await repo.insertEvent({ id: newId('ev'), graphId: id, revision: graph.revision, actor: p.actor, source: p.source, summary: [`published version ${version.version}${note ? `: ${note}` : ''}`], createdAt: version.createdAt });
    });
    this.events.publish({ type: 'graph.published', workspaceId: p.workspaceId, graphId: id, version: version.version });
    return { version: version.version, issues };
  }

  async listVersions(p: Principal, id: string) {
    await this.require(p, id);
    return this.graphs.listVersions(id);
  }

  async getVersion(p: Principal, id: string, version: number) {
    await this.require(p, id);
    const found = await this.graphs.findVersion(id, version);
    if (!found) throw notFound(`version ${version}`);
    return found;
  }

  async restoreVersion(p: Principal, id: string, version: number): Promise<GraphWithIssues> {
    const graph = await this.require(p, id);
    const found = await this.graphs.findVersion(id, version);
    if (!found) throw notFound(`version ${version}`);
    return this.withIssues(await this.commitDraft(p, graph, found.doc, [`restored the draft from version ${version}`]));
  }

  async history(p: Principal, id: string, limit = 100) {
    await this.require(p, id);
    return this.graphs.listEvents(id, limit);
  }

  async archive(p: Principal, id: string): Promise<void> {
    await this.require(p, id);
    await this.graphs.archive(id, Date.now());
    this.events.publish({ type: 'graph.archived', workspaceId: p.workspaceId, graphId: id });
  }

  async require(p: Principal, id: string): Promise<Graph> {
    const graph = await this.graphs.find(p.workspaceId, id);
    if (!graph) throw notFound(`flow ${id}`);
    return graph;
  }

  /** `summary` null means a layout-only change, which is not worth a history entry. */
  private async commitDraft(p: Principal, graph: Graph, draft: GraphDoc, summary: string[] | null): Promise<Graph> {
    const now = Date.now();
    const revision = graph.revision + 1;
    await this.graphs.transaction(async (repo) => {
      if (!(await repo.updateDraft(graph.id, graph.revision, draft, now))) {
        throw conflict('the flow was changed by someone else at the same time; re-read it and retry');
      }
      if (summary) await repo.insertEvent({ id: newId('ev'), graphId: graph.id, revision, actor: p.actor, source: p.source, summary, createdAt: now });
    });
    const updated = { ...graph, draft, revision, updatedAt: now };
    this.changed(p, updated);
    return updated;
  }

  private check(doc: GraphDoc) {
    return validateGraph(doc, { tool: (name) => this.tools.get(name), skill: (name) => this.skills.get(name) });
  }

  private withIssues(graph: Graph): GraphWithIssues {
    return { ...graph, issues: this.check(graph.draft) };
  }

  private changed(p: Principal, graph: Graph) {
    this.events.publish({ type: 'graph.changed', workspaceId: p.workspaceId, graphId: graph.id, revision: graph.revision, actor: p.actor, source: p.source });
  }
}

/** Two drafts describe the same flow when they differ only in node positions. */
function sameFlow(a: GraphDoc, b: GraphDoc) {
  const strip = (doc: GraphDoc) => stableStringify({ nodes: doc.nodes.map(({ position: _, ...n }) => n), edges: doc.edges });
  return strip(a) === strip(b);
}

