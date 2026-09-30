import type { Graph, GraphDoc, GraphEvent, GraphSummary, GraphVersion } from '@agent-flow/core';
import type { Selectable } from 'kysely';
import { fromJson, toJson, type Database } from '../db/database.js';
import type { GraphEventsTable, GraphsTable, GraphVersionsTable } from '../db/schema.js';

const SUMMARY_COLUMNS = ['id', 'title', 'description', 'revision', 'latest_version', 'created_at', 'updated_at'] as const;

export class GraphRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(fn: (repo: GraphRepository) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(new GraphRepository(trx)));
  }

  async insert(workspaceId: string, graph: Graph): Promise<void> {
    await this.db
      .insertInto('graphs')
      .values({
        id: graph.id,
        workspace_id: workspaceId,
        title: graph.title,
        description: graph.description,
        draft: toJson(graph.draft),
        revision: graph.revision,
        latest_version: graph.latestVersion,
        created_at: graph.createdAt,
        updated_at: graph.updatedAt,
        archived_at: null,
      })
      .execute();
  }

  async list(workspaceId: string): Promise<GraphSummary[]> {
    const rows = await this.db
      .selectFrom('graphs')
      .select(SUMMARY_COLUMNS)
      .where('workspace_id', '=', workspaceId)
      .where('archived_at', 'is', null)
      .orderBy('updated_at', 'desc')
      .execute();
    return rows.map(toSummary);
  }

  async find(workspaceId: string, id: string): Promise<Graph | null> {
    const row = await this.db
      .selectFrom('graphs')
      .selectAll()
      .where('id', '=', id)
      .where('workspace_id', '=', workspaceId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    return row ? { ...toSummary(row), draft: fromJson<GraphDoc>(row.draft) } : null;
  }

  /** Optimistic write: succeeds only if the draft is still at `expectedRevision`. */
  async updateDraft(id: string, expectedRevision: number, draft: GraphDoc, now: number): Promise<boolean> {
    const result = await this.db
      .updateTable('graphs')
      .set({ draft: toJson(draft), revision: expectedRevision + 1, updated_at: now })
      .where('id', '=', id)
      .where('revision', '=', expectedRevision)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async updateMeta(id: string, meta: { title?: string; description?: string }, now: number): Promise<void> {
    await this.db.updateTable('graphs').set({ ...meta, updated_at: now }).where('id', '=', id).execute();
  }

  async archive(id: string, now: number): Promise<void> {
    await this.db.updateTable('graphs').set({ archived_at: now, updated_at: now }).where('id', '=', id).execute();
  }

  async insertVersion(version: GraphVersion): Promise<void> {
    await this.db
      .insertInto('graph_versions')
      .values({
        graph_id: version.graphId,
        version: version.version,
        doc: toJson(version.doc),
        note: version.note,
        created_by: version.createdBy,
        created_at: version.createdAt,
      })
      .execute();
    await this.db.updateTable('graphs').set({ latest_version: version.version }).where('id', '=', version.graphId).execute();
  }

  async listVersions(graphId: string): Promise<Omit<GraphVersion, 'doc'>[]> {
    const rows = await this.db
      .selectFrom('graph_versions')
      .select(['graph_id', 'version', 'note', 'created_by', 'created_at'])
      .where('graph_id', '=', graphId)
      .orderBy('version', 'desc')
      .execute();
    return rows.map((r) => ({ graphId: r.graph_id, version: r.version, note: r.note, createdBy: r.created_by, createdAt: r.created_at }));
  }

  async findVersion(graphId: string, version: number): Promise<GraphVersion | null> {
    const row = await this.db
      .selectFrom('graph_versions')
      .selectAll()
      .where('graph_id', '=', graphId)
      .where('version', '=', version)
      .executeTakeFirst();
    return row ? toVersion(row) : null;
  }

  async insertEvent(event: GraphEvent): Promise<void> {
    await this.db
      .insertInto('graph_events')
      .values({
        id: event.id,
        graph_id: event.graphId,
        revision: event.revision,
        actor: event.actor,
        source: event.source,
        summary: toJson(event.summary),
        created_at: event.createdAt,
      })
      .execute();
  }

  async listEvents(graphId: string, limit: number): Promise<GraphEvent[]> {
    const rows = await this.db
      .selectFrom('graph_events')
      .selectAll()
      .where('graph_id', '=', graphId)
      .orderBy('revision', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toEvent);
  }
}

function toSummary(row: Pick<Selectable<GraphsTable>, (typeof SUMMARY_COLUMNS)[number]>): GraphSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    revision: row.revision,
    latestVersion: row.latest_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const toVersion = (row: Selectable<GraphVersionsTable>): GraphVersion => ({
  graphId: row.graph_id,
  version: row.version,
  doc: fromJson<GraphDoc>(row.doc),
  note: row.note,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

const toEvent = (row: Selectable<GraphEventsTable>): GraphEvent => ({
  id: row.id,
  graphId: row.graph_id,
  revision: row.revision,
  actor: row.actor,
  source: row.source,
  summary: fromJson<string[]>(row.summary),
  createdAt: row.created_at,
});
