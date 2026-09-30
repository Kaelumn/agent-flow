import { EdgeInput, EdgePatch, NodeInput, NodePatch, ToolOutcome, type GraphDoc } from '@agent-flow/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toAppError } from '../common/errors.js';
import type { Principal } from '../common/principal.js';
import type { Services } from '../container.js';
import type { EditResult } from '../services/graph-service.js';
import type { Authenticate } from './auth.js';

const INSTRUCTIONS = `Agent Flow stores SOPs as flowcharts that you build with the user and then follow.

Building a flow:
1. tools_search to find real tool names and parameters. Never invent tool names.
2. flow_create, then flow_add_nodes / flow_add_edges. Give nodes readable ids (e.g. "check_user") so you can connect them in the same turn.
3. Every node type is start, tool or end. Branches are edges with a natural-language condition; mark at most one edge per node as isDefault.
4. After each change read the returned issues and fix errors. flow_publish once there are none.
5. Check feedback_list: people leave questions and change requests on nodes in the canvas. Apply them, then feedback_answer.

Running a flow:
run_start, then repeat: read the step, call the named tool yourself, run_submit the outcome and the edge whose condition holds, until the run ends.
The server rejects steps out of order and edges that do not leave the current node.`;

const FlowId = z.string().describe('Flow id');
const ExpectedRevision = z.number().int().optional().describe('Fail instead of overwriting if the flow changed since this revision');

export async function mcpRoutes(app: FastifyInstance, { services, authenticate }: { services: Services; authenticate: Authenticate }) {
  app.post('/', async (req, reply) => {
    const principal = authenticate(req, 'mcp');
    const server = buildServer(services, principal, (err) => req.log.error(err));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST.' }, id: null };
  app.get('/', async (_req, reply) => reply.code(405).send(notAllowed));
  app.delete('/', async (_req, reply) => reply.code(405).send(notAllowed));
}

function buildServer({ graphs, feedback, runs, tools }: Services, p: Principal, logError: (err: unknown) => void) {
  const server = new McpServer({ name: 'agent-flow', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const tool = <S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema }, (async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await handler(args)) }] };
      } catch (err) {
        const appError = toAppError(err);
        if (!appError) logError(err);
        const body = appError ? { error: appError.code, message: appError.message, details: appError.details } : { error: 'internal', message: 'unexpected server error' };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
      }
    }) as never);

  const edited = ({ graph, createdNodeIds, createdEdgeIds }: EditResult) => ({
    revision: graph.revision,
    createdNodeIds,
    createdEdgeIds,
    issues: graph.issues,
  });

  // ---- Tool catalog
  tool('tools_search', 'Find tools that flow nodes can call. Returns names, descriptions, whether they write, and parameter schemas.', {
    query: z.string().optional().describe('Words matched against name and description'),
    connector: z.string().optional().describe('e.g. microsoft-graph, autotask, mspbots'),
  }, async ({ query, connector }) => tools.list({ query, connector }));

  // ---- Building flows
  tool('flow_list', 'List the flows in this workspace.', {}, async () => graphs.list(p));

  tool('flow_create', 'Create a flow. It starts with a "start" node and an "end" node that are not yet connected.', {
    title: z.string().min(1).max(120),
    description: z.string().optional().describe('What the SOP is for and when it applies'),
  }, async (args) => {
    const g = await graphs.create(p, args);
    return { flowId: g.id, revision: g.revision, draft: compact(g.draft), issues: g.issues };
  });

  tool('flow_get', 'Read a flow: its draft nodes and edges, revision, latest published version and validation issues.', { flowId: FlowId }, async ({ flowId }) => {
    const g = await graphs.get(p, flowId);
    return { flowId: g.id, title: g.title, description: g.description, revision: g.revision, latestVersion: g.latestVersion, draft: compact(g.draft), issues: g.issues };
  });

  tool('flow_update', 'Change the title or description of a flow.', {
    flowId: FlowId,
    title: z.string().min(1).max(120).optional(),
    description: z.string().optional(),
  }, async ({ flowId, ...meta }) => {
    const g = await graphs.updateMeta(p, flowId, meta);
    return { flowId: g.id, title: g.title, description: g.description };
  });

  tool('flow_add_nodes', 'Add one or more nodes. Tool nodes need tool.name from tools_search; argsHint tells the runner where each argument comes from.', {
    flowId: FlowId,
    nodes: z.array(NodeInput).min(1),
    expectedRevision: ExpectedRevision,
  }, async ({ flowId, nodes, expectedRevision }) => edited(await graphs.edit(p, flowId, [{ op: 'addNodes', nodes }], expectedRevision)));

  tool('flow_update_node', 'Change fields of a node. Set a field to null to clear it. The node type cannot change.', {
    flowId: FlowId,
    nodeId: z.string(),
    patch: NodePatch,
    expectedRevision: ExpectedRevision,
  }, async ({ flowId, nodeId, patch, expectedRevision }) => edited(await graphs.edit(p, flowId, [{ op: 'updateNode', nodeId, patch }], expectedRevision)));

  tool('flow_remove_node', 'Remove a node and every edge touching it.', {
    flowId: FlowId,
    nodeId: z.string(),
    expectedRevision: ExpectedRevision,
  }, async ({ flowId, nodeId, expectedRevision }) => edited(await graphs.edit(p, flowId, [{ op: 'removeNode', nodeId }], expectedRevision)));

  tool('flow_add_edges', 'Connect nodes. When a node has several outgoing edges each needs a condition, or be the single isDefault edge.', {
    flowId: FlowId,
    edges: z.array(EdgeInput).min(1),
    expectedRevision: ExpectedRevision,
  }, async ({ flowId, edges, expectedRevision }) => edited(await graphs.edit(p, flowId, [{ op: 'addEdges', edges }], expectedRevision)));

  tool('flow_update_edge', 'Change the endpoints, condition or default flag of an edge.', {
    flowId: FlowId,
    edgeId: z.string(),
    patch: EdgePatch,
    expectedRevision: ExpectedRevision,
  }, async ({ flowId, edgeId, patch, expectedRevision }) => edited(await graphs.edit(p, flowId, [{ op: 'updateEdge', edgeId, patch }], expectedRevision)));

  tool('flow_remove_edge', 'Remove an edge.', {
    flowId: FlowId,
    edgeId: z.string(),
    expectedRevision: ExpectedRevision,
  }, async ({ flowId, edgeId, expectedRevision }) => edited(await graphs.edit(p, flowId, [{ op: 'removeEdge', edgeId }], expectedRevision)));

  tool('flow_validate', 'Check the draft. Errors block publishing; warnings are advice.', { flowId: FlowId }, async ({ flowId }) => ({ issues: await graphs.validate(p, flowId) }));

  tool('flow_publish', 'Publish the draft as a new immutable version. Runs always use a published version.', {
    flowId: FlowId,
    note: z.string().default('').describe('What changed in this version'),
  }, async ({ flowId, note }) => graphs.publish(p, flowId, note));

  // ---- Feedback from people on the canvas
  tool('feedback_list', 'List feedback people left on a flow or its nodes. Defaults to open items.', {
    flowId: FlowId,
    status: z.array(z.enum(['open', 'answered', 'resolved'])).default(['open']),
  }, async ({ flowId, status }) => feedback.list(p, flowId, status));

  tool('feedback_answer', 'Reply to a feedback item, e.g. to say what you changed or to ask for clarification.', {
    feedbackId: z.string(),
    answer: z.string().min(1),
  }, async ({ feedbackId, answer }) => feedback.answer(p, feedbackId, answer));

  tool('feedback_resolve', 'Mark a feedback item as resolved once it has been handled.', { feedbackId: z.string() }, async ({ feedbackId }) =>
    feedback.setStatus(p, feedbackId, 'resolved'),
  );

  // ---- Running flows
  tool('run_start', 'Start a run of the latest published version (or a given one). Returns the first step to perform.', {
    flowId: FlowId,
    inputs: z.record(z.string(), z.unknown()).default({}).describe('Values for the start node inputs'),
    version: z.number().int().positive().optional(),
  }, async ({ flowId, inputs, version }) => runs.start(p, flowId, { inputs, version }));

  tool('run_current', 'Show the step a run is waiting on: node instruction, tool to call, argument hints, outgoing edges and context.', { runId: z.string() }, async ({ runId }) =>
    runs.current(p, runId),
  );

  tool('run_submit', 'Report the current step and move on. Tool nodes need an outcome. Give edgeId when the node has more than one outgoing edge.', {
    runId: z.string(),
    nodeId: z.string().describe('Must be the node the run is currently at'),
    outcome: ToolOutcome.optional(),
    edgeId: z.string().optional(),
  }, async ({ runId, ...submission }) => runs.submit(p, runId, submission));

  tool('run_cancel', 'Cancel a running run.', { runId: z.string() }, async ({ runId }) => runs.cancel(p, runId));

  tool('run_get', 'Read a run and every step taken so far.', { runId: z.string() }, async ({ runId }) => runs.get(p, runId));

  return server;
}

/** Drafts without canvas positions: smaller for the model, same meaning. */
const compact = (doc: GraphDoc) => ({ nodes: doc.nodes.map(({ position: _, ...n }) => n), edges: doc.edges });
