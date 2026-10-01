import { Migrator, type Kysely, type Migration } from 'kysely';
import type { Database } from './database.js';

/**
 * Migrations use only portable column types (varchar, text, integer, bigint, json)
 * so the same history runs on MySQL and PostgreSQL. Append new entries; never edit applied ones.
 */
const migrations: Record<string, Migration> = {
  '0001_init': {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('graphs')
        .addColumn('id', 'varchar(32)', (c) => c.primaryKey())
        .addColumn('workspace_id', 'varchar(64)', (c) => c.notNull())
        .addColumn('title', 'varchar(120)', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull())
        .addColumn('draft', 'json', (c) => c.notNull())
        .addColumn('revision', 'integer', (c) => c.notNull())
        .addColumn('latest_version', 'integer')
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('updated_at', 'bigint', (c) => c.notNull())
        .addColumn('archived_at', 'bigint')
        .execute();
      await db.schema.createIndex('graphs_workspace_updated').on('graphs').columns(['workspace_id', 'updated_at']).execute();

      await db.schema
        .createTable('graph_versions')
        .addColumn('graph_id', 'varchar(32)', (c) => c.notNull())
        .addColumn('version', 'integer', (c) => c.notNull())
        .addColumn('doc', 'json', (c) => c.notNull())
        .addColumn('note', 'text', (c) => c.notNull())
        .addColumn('created_by', 'varchar(128)', (c) => c.notNull())
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addPrimaryKeyConstraint('graph_versions_pk', ['graph_id', 'version'])
        .execute();

      await db.schema
        .createTable('graph_events')
        .addColumn('id', 'varchar(32)', (c) => c.primaryKey())
        .addColumn('graph_id', 'varchar(32)', (c) => c.notNull())
        .addColumn('revision', 'integer', (c) => c.notNull())
        .addColumn('actor', 'varchar(128)', (c) => c.notNull())
        .addColumn('source', 'varchar(16)', (c) => c.notNull())
        .addColumn('summary', 'json', (c) => c.notNull())
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .execute();
      await db.schema.createIndex('graph_events_graph_revision').on('graph_events').columns(['graph_id', 'revision']).execute();

      await db.schema
        .createTable('feedback')
        .addColumn('id', 'varchar(32)', (c) => c.primaryKey())
        .addColumn('graph_id', 'varchar(32)', (c) => c.notNull())
        .addColumn('node_id', 'varchar(64)')
        .addColumn('kind', 'varchar(16)', (c) => c.notNull())
        .addColumn('text', 'text', (c) => c.notNull())
        .addColumn('author', 'varchar(128)', (c) => c.notNull())
        .addColumn('status', 'varchar(16)', (c) => c.notNull())
        .addColumn('answer', 'text')
        .addColumn('answered_by', 'varchar(128)')
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('updated_at', 'bigint', (c) => c.notNull())
        .execute();
      await db.schema.createIndex('feedback_graph_status').on('feedback').columns(['graph_id', 'status']).execute();

      await db.schema
        .createTable('runs')
        .addColumn('id', 'varchar(32)', (c) => c.primaryKey())
        .addColumn('workspace_id', 'varchar(64)', (c) => c.notNull())
        .addColumn('graph_id', 'varchar(32)', (c) => c.notNull())
        .addColumn('version', 'integer', (c) => c.notNull())
        .addColumn('status', 'varchar(16)', (c) => c.notNull())
        .addColumn('current_node_id', 'varchar(64)')
        .addColumn('inputs', 'json', (c) => c.notNull())
        .addColumn('context', 'json', (c) => c.notNull())
        .addColumn('started_by', 'varchar(128)', (c) => c.notNull())
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('updated_at', 'bigint', (c) => c.notNull())
        .addColumn('ended_at', 'bigint')
        .execute();
      await db.schema.createIndex('runs_graph_created').on('runs').columns(['graph_id', 'created_at']).execute();

      await db.schema
        .createTable('run_steps')
        .addColumn('id', 'varchar(32)', (c) => c.primaryKey())
        .addColumn('run_id', 'varchar(32)', (c) => c.notNull())
        .addColumn('seq', 'integer', (c) => c.notNull())
        .addColumn('node_id', 'varchar(64)', (c) => c.notNull())
        .addColumn('edge_id', 'varchar(64)')
        .addColumn('status', 'varchar(16)', (c) => c.notNull())
        .addColumn('tool_name', 'varchar(128)')
        .addColumn('args', 'json')
        .addColumn('result', 'json')
        .addColumn('error', 'text')
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addUniqueConstraint('run_steps_run_seq', ['run_id', 'seq'])
        .execute();
    },
    async down(db: Kysely<any>) {
      for (const table of ['run_steps', 'runs', 'feedback', 'graph_events', 'graph_versions', 'graphs']) {
        await db.schema.dropTable(table).execute();
      }
    },
  },
  // Canvas annotations go straight to the agent's conversation; nothing is stored any more.
  '0002_drop_feedback': {
    async up(db: Kysely<any>) {
      await db.schema.dropTable('feedback').ifExists().execute();
    },
    async down(db: Kysely<any>) {
      await db.schema
        .createTable('feedback')
        .addColumn('id', 'varchar(32)', (c) => c.primaryKey())
        .addColumn('graph_id', 'varchar(32)', (c) => c.notNull())
        .addColumn('node_id', 'varchar(64)')
        .addColumn('kind', 'varchar(16)', (c) => c.notNull())
        .addColumn('text', 'text', (c) => c.notNull())
        .addColumn('author', 'varchar(128)', (c) => c.notNull())
        .addColumn('status', 'varchar(16)', (c) => c.notNull())
        .addColumn('answer', 'text')
        .addColumn('answered_by', 'varchar(128)')
        .addColumn('created_at', 'bigint', (c) => c.notNull())
        .addColumn('updated_at', 'bigint', (c) => c.notNull())
        .execute();
      await db.schema.createIndex('feedback_graph_status').on('feedback').columns(['graph_id', 'status']).execute();
    },
  },
};

export async function migrateToLatest(db: Database) {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return results ?? [];
}
