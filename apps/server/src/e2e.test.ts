import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './container.js';
import { createDatabase, type Database } from './db/database.js';
import { migrateToLatest } from './db/migrations.js';
import { tokenAuthenticator } from './http/auth.js';
import { StaticToolCatalog } from './services/tool-catalog.js';

/** Runs against the database in .env, inside a throwaway workspace. */
const ENV_FILE = new URL('../../../.env', import.meta.url);
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const workspace = `test-${Date.now().toString(36)}`;
const AGENT = 'agent-token-e2e';
const WEB = 'web-token-e2e';

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let base: string;
let client: Client;

async function call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const body = JSON.parse(result.content[0]!.text);
  if (result.isError) throw Object.assign(new Error(body.message), body);
  return body;
}

beforeAll(async () => {
  const config = loadConfig({ ...process.env, AUTH_TOKENS: `${AGENT}:${workspace}:agent,${WEB}:${workspace}:felix`, LOG_LEVEL: 'warn' });
  db = await createDatabase(config);
  await migrateToLatest(db);
  const services = createServices(db, await StaticToolCatalog.fromFile(config.TOOL_CATALOG_PATH));
  app = await buildApp({ config, db, services, authenticate: tokenAuthenticator(config.AUTH_TOKENS) });
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${AGENT}` } } }));
});

afterAll(async () => {
  await client?.close();
  await app?.close();
  if (db) {
    const graphIds = (await db.selectFrom('graphs').select('id').where('workspace_id', '=', workspace).execute()).map((g) => g.id);
    if (graphIds.length) {
      const runIds = (await db.selectFrom('runs').select('id').where('graph_id', 'in', graphIds).execute()).map((r) => r.id);
      if (runIds.length) await db.deleteFrom('run_steps').where('run_id', 'in', runIds).execute();
      for (const table of ['runs', 'feedback', 'graph_events', 'graph_versions'] as const) await db.deleteFrom(table).where('graph_id', 'in', graphIds).execute();
      await db.deleteFrom('graphs').where('id', 'in', graphIds).execute();
    }
    await db.destroy();
  }
});

describe('agent builds and runs a flow over MCP', () => {
  let flowId: string;

  it('rejects calls without a valid token', async () => {
    const res = await fetch(`${base}/api/graphs`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('exposes the tool catalog', async () => {
    const found = await call<{ name: string }[]>('tools_search', { query: 'check user exists' });
    expect(found.map((t) => t.name)).toContain('graph_check_user_exists');
  });

  it('builds a flow through chat-style edits', async () => {
    const created = await call('flow_create', { title: 'Account check', description: 'e2e' });
    flowId = created.flowId;
    expect(created.issues.map((i: any) => i.code)).toContain('dead_end');

    const added = await call('flow_add_nodes', {
      flowId,
      nodes: [
        { id: 'check', type: 'tool', title: 'Check account', tool: { name: 'graph_check_user_exists', argsHint: { upn: 'input upn' } }, outputKey: 'exists' },
        { id: 'exists', type: 'end', title: 'Already exists', outcome: 'stopped' },
      ],
    });
    expect(added.createdNodeIds).toEqual(['check', 'exists']);

    const wrongTool = await call('flow_add_nodes', { flowId, nodes: [{ id: 'bad', type: 'tool', title: 'Bad', tool: { name: 'made_up_tool', argsHint: {} } }] });
    expect(wrongTool.issues.map((i: any) => i.code)).toContain('tool_unknown');
    await call('flow_remove_node', { flowId, nodeId: 'bad' });

    await call('flow_update_node', { flowId, nodeId: 'start', patch: { inputs: [{ name: 'upn', description: 'User principal name' }] } });
    const wired = await call('flow_add_edges', {
      flowId,
      edges: [
        { id: 'e_start', source: 'start', target: 'check' },
        { id: 'e_exists', source: 'check', target: 'exists', condition: 'the account exists' },
        { id: 'e_new', source: 'check', target: 'end', isDefault: true },
      ],
    });
    expect(wired.issues).toEqual([]);
  });

  it('refuses stale revisions', async () => {
    await expect(call('flow_update_node', { flowId, nodeId: 'check', patch: { instruction: 'x' }, expectedRevision: 1 })).rejects.toMatchObject({ error: 'conflict' });
  });

  it('closes the feedback loop with the canvas', async () => {
    const res = await fetch(`${base}/api/graphs/${flowId}/feedback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${WEB}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'check', kind: 'directive', text: 'Lowercase the UPN before checking' }),
    });
    expect(res.status).toBe(201);
    const [item] = await call<any[]>('feedback_list', { flowId });
    expect(item.text).toContain('Lowercase');
    await call('flow_update_node', { flowId, nodeId: 'check', patch: { instruction: 'Lowercase the UPN first' } });
    await call('feedback_answer', { feedbackId: item.id, answer: 'Added to the node instruction' });
    expect(await call('feedback_list', { flowId })).toEqual([]);
  });

  it('publishes and follows the flow step by step', async () => {
    await expect(call('run_start', { flowId, inputs: { upn: 'a@b.c' } })).rejects.toMatchObject({ error: 'invalid' });
    expect((await call('flow_publish', { flowId, note: 'first' })).version).toBe(1);
    await expect(call('flow_publish', { flowId })).rejects.toMatchObject({ error: 'conflict' });

    await expect(call('run_start', { flowId, inputs: {} })).rejects.toMatchObject({ error: 'invalid' });
    const step = await call('run_start', { flowId, inputs: { upn: 'jane@contoso.com' } });
    expect(step.node.id).toBe('check');
    expect(step.tool.name).toBe('graph_check_user_exists');
    expect(step.options.map((o: any) => o.edgeId)).toEqual(['e_exists', 'e_new']);

    const runId = step.run.id;
    await expect(call('run_submit', { runId, nodeId: 'start' })).rejects.toMatchObject({ error: 'conflict' });
    await expect(call('run_submit', { runId, nodeId: 'check', outcome: { status: 'succeeded', result: false } })).rejects.toMatchObject({ error: 'invalid' });
    await expect(call('run_submit', { runId, nodeId: 'check', outcome: { status: 'succeeded' }, edgeId: 'e_start' })).rejects.toMatchObject({ error: 'invalid' });

    const done = await call('run_submit', { runId, nodeId: 'check', outcome: { status: 'succeeded', args: { upn: 'jane@contoso.com' }, result: false }, edgeId: 'e_new' });
    expect(done.run.status).toBe('completed');
    expect(done.context).toEqual({ exists: false });

    const { steps } = await call('run_get', { runId });
    expect(steps.map((s: any) => [s.nodeId, s.edgeId, s.status])).toEqual([
      ['start', 'e_start', 'passed'],
      ['check', 'e_new', 'succeeded'],
    ]);
    await expect(call('run_submit', { runId, nodeId: 'end' })).rejects.toMatchObject({ error: 'conflict' });
  });

  it('stops the run when a tool fails and the node says stop', async () => {
    const { run } = await call('run_start', { flowId, inputs: { upn: 'x@contoso.com' } });
    const failed = await call('run_submit', { runId: run.id, nodeId: 'check', outcome: { status: 'failed', error: 'Graph 503' } });
    expect([failed.run.status, failed.run.currentNodeId]).toEqual(['failed', 'check']);
  });
});
