import type { Run, RunStatus, RunStep, StepStatus } from '@agent-flow/core';
import type { Selectable } from 'kysely';
import { fromJson, toJson, type Database } from '../db/database.js';
import type { RunStepsTable, RunsTable } from '../db/schema.js';

export class RunRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(fn: (repo: RunRepository) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(new RunRepository(trx)));
  }

  async insert(workspaceId: string, run: Run): Promise<void> {
    await this.db
      .insertInto('runs')
      .values({
        id: run.id,
        workspace_id: workspaceId,
        graph_id: run.graphId,
        version: run.version,
        status: run.status,
        current_node_id: run.currentNodeId,
        inputs: toJson(run.inputs),
        context: toJson(run.context),
        started_by: run.startedBy,
        created_at: run.createdAt,
        updated_at: run.updatedAt,
        ended_at: run.endedAt,
      })
      .execute();
  }

  async find(workspaceId: string, id: string): Promise<Run | null> {
    const row = await this.db
      .selectFrom('runs')
      .selectAll()
      .where('id', '=', id)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    return row ? toRun(row) : null;
  }

  async list(workspaceId: string, graphId: string, limit: number): Promise<Run[]> {
    const rows = await this.db
      .selectFrom('runs')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('graph_id', '=', graphId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toRun);
  }

  /** Moves a run only if it is still running at `fromNodeId`, so concurrent submissions cannot both win. */
  async advance(
    id: string,
    fromNodeId: string,
    next: { status: RunStatus; currentNodeId: string | null; context: Record<string, unknown>; endedAt: number | null },
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('runs')
      .set({
        status: next.status,
        current_node_id: next.currentNodeId,
        context: toJson(next.context),
        ended_at: next.endedAt,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('status', '=', 'running')
      .where('current_node_id', '=', fromNodeId)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async cancel(id: string, now: number): Promise<boolean> {
    const result = await this.db
      .updateTable('runs')
      .set({ status: 'cancelled', ended_at: now, updated_at: now })
      .where('id', '=', id)
      .where('status', '=', 'running')
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async nextSeq(runId: string): Promise<number> {
    const row = await this.db
      .selectFrom('run_steps')
      .select((eb) => eb.fn.max<number | null>('seq').as('max'))
      .where('run_id', '=', runId)
      .executeTakeFirst();
    return (row?.max ?? 0) + 1;
  }

  async insertStep(step: RunStep): Promise<void> {
    await this.db
      .insertInto('run_steps')
      .values({
        id: step.id,
        run_id: step.runId,
        seq: step.seq,
        node_id: step.nodeId,
        edge_id: step.edgeId,
        status: step.status,
        tool_name: step.toolName,
        args: step.args === null ? null : toJson(step.args),
        result: step.result === undefined ? null : toJson(step.result),
        error: step.error,
        created_at: step.createdAt,
      })
      .execute();
  }

  async listSteps(runId: string): Promise<RunStep[]> {
    const rows = await this.db.selectFrom('run_steps').selectAll().where('run_id', '=', runId).orderBy('seq').execute();
    return rows.map(toStep);
  }
}

const toRun = (row: Selectable<RunsTable>): Run => ({
  id: row.id,
  graphId: row.graph_id,
  version: row.version,
  status: row.status as RunStatus,
  currentNodeId: row.current_node_id,
  inputs: fromJson(row.inputs),
  context: fromJson(row.context),
  startedBy: row.started_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  endedAt: row.ended_at,
});

const toStep = (row: Selectable<RunStepsTable>): RunStep => ({
  id: row.id,
  runId: row.run_id,
  seq: row.seq,
  nodeId: row.node_id,
  edgeId: row.edge_id,
  status: row.status as StepStatus,
  toolName: row.tool_name,
  args: row.args === null ? null : fromJson(row.args),
  result: row.result === null ? null : fromJson(row.result),
  error: row.error,
  createdAt: row.created_at,
});
