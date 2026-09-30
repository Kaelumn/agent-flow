import type { Feedback, FeedbackKind, FeedbackStatus } from '@agent-flow/core';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.js';
import type { FeedbackTable } from '../db/schema.js';

export class FeedbackRepository {
  constructor(private readonly db: Database) {}

  async insert(item: Feedback): Promise<void> {
    await this.db
      .insertInto('feedback')
      .values({
        id: item.id,
        graph_id: item.graphId,
        node_id: item.nodeId,
        kind: item.kind,
        text: item.text,
        author: item.author,
        status: item.status,
        answer: item.answer,
        answered_by: item.answeredBy,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })
      .execute();
  }

  async list(graphId: string, statuses?: FeedbackStatus[]): Promise<Feedback[]> {
    let query = this.db.selectFrom('feedback').selectAll().where('graph_id', '=', graphId);
    if (statuses?.length) query = query.where('status', 'in', statuses);
    const rows = await query.orderBy('created_at', 'desc').execute();
    return rows.map(toFeedback);
  }

  async find(id: string): Promise<Feedback | null> {
    const row = await this.db.selectFrom('feedback').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toFeedback(row) : null;
  }

  async update(id: string, patch: { status: FeedbackStatus; answer?: string; answeredBy?: string }, now: number): Promise<void> {
    await this.db
      .updateTable('feedback')
      .set({
        status: patch.status,
        ...(patch.answer !== undefined && { answer: patch.answer, answered_by: patch.answeredBy ?? null }),
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
  }
}

const toFeedback = (row: Selectable<FeedbackTable>): Feedback => ({
  id: row.id,
  graphId: row.graph_id,
  nodeId: row.node_id,
  kind: row.kind as FeedbackKind,
  text: row.text,
  author: row.author,
  status: row.status as FeedbackStatus,
  answer: row.answer,
  answeredBy: row.answered_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
