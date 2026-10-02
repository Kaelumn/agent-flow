import { EdgeInput, EdgePatch, isUnfinished, NodeInput, NodePatch, ToolOutcome, type GraphDoc, type Issue } from '@agent-flow/core';
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
1. tools_search to find real tool names and parameters, skills_search for skills. Never invent either.
2. flow_create, then flow_add_nodes / flow_add_edges. Give nodes readable ids (e.g. "check_user") so you can connect them in the same turn.
3. Every node type is start, tool or end. A "tool" node is a step: it calls a tool, follows a skill, or neither (the agent does it from the instruction, e.g. classify, extract, draft). Use at most one of tool and skill. List what a step's result should contain in outputs; it guides the runner and is not enforced. Branches are edges with a natural-language condition; mark at most one edge per node as isDefault.
   In argsHint and instructions, refer to data with {{input.<name>}} for run inputs and {{<outputKey>.<field>}} for a result an earlier step saved with outputKey (e.g. {{new_user.id}}). The validator checks that such data exists and is produced before the step; the runner fills in the values. Give every step whose result is used later an outputKey. Keep free text only for values the agent must derive.
4. Each edit returns "issues" that are wrong now (unknown tool, bad argument, ...): fix them right away. "unfinished" only counts gaps that close as you keep building (steps not yet connected, references to steps not yet added). When the flow is complete, flow_validate lists everything left; flow_publish once it has no errors.
5. Reviewers annotate the canvas and the annotations arrive in the conversation as an "[Agent Flow] … annotations" notice listing node and edge ids and the draft revision they were written against. flow_get, apply each note to the draft, then summarise what you changed per annotation.

Running a flow:
run_start, then repeat: read the step, call the named tool yourself, run_submit the outcome and the edge whose condition holds, until the run ends.
The server rejects steps out of order and edges that do not leave the current node.`;

const FlowId = z.string().describe('Flow id');
const ExpectedRevision = z.number().int().optional().describe('Fail instead of overwriting if the flow changed since this revision');

interface McpOptions {
  services: Services;
  authenticate: Authenticate;
  publicWebUrl?: string;
}

export async function mcpRoutes(app: FastifyInstance, { services, authenticate, publicWebUrl }: McpOptions) {
  app.post('/', async (req, reply) => {
    const principal = authenticate(req, 'mcp');
    const canvasUrl = (flowId: string) => (publicWebUrl ? `${publicWebUrl.replace(/\/$/, '')}/#/flows/${flowId}` : undefined);
    const server = buildServer(services, principal, canvasUrl, (err) => req.log.error(err));
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

function buildServer({ graphs, runs, tools, skills }: Services, p: Principal, canvasUrl: (flowId: string) => string | undefined, logError: (err: unknown) => void) {
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

  /** While building, list what is wrong now and only count what is merely unfinished; flow_validate lists everything. */
  const building = (issues: Issue[]) => {
    const unfinished: Record<string, number> = {};
    for (const i of issues) if (isUnfinished(i)) unfinished[i.code] = (unfinished[i.code] ?? 0) + 1;
    return { issues: issues.filter((i) => !isUnfinished(i)), ...(Object.keys(unfinished).length && { unfinished }) };
  };
  const edited = ({ graph, createdNodeIds, createdEdgeIds }: EditResult) => ({ revision: graph.revision, createdNodeIds, createdEdgeIds, ...building(graph.issues) });

  // ---- Tool catalog
  tool('tools_search', 'Find tools that flow nodes can call. Returns names, descriptions, whether they write, and parameter schemas.', {
    query: z.string().optional().describe('Words matched against name and description'),
    connector: z.string().optional().describe('e.g. microsoft-graph, autotask, mspbots'),
  }, async ({ query, connector }) => tools.list({ query, connector }));

  tool('skills_search', 'Find skills a step can follow instead of calling a tool. Returns names and descriptions.', {
    query: z.string().optional().describe('Words matched against name and description'),
  }, async ({ query }) => skills.list({ query }));

  // ---- Building flows
  tool('flow_list', 'List the flows in this workspace.', {}, async () => graphs.list(p));

  tool('flow_create', 'Create a flow. It starts with a "start" node and an "end" node that are not yet connected.', {
    title: z.string().min(1).max(120),
    description: z.string().optional().describe('What the SOP is for and when it applies'),
  }, async (args) => {
    const g = await graphs.create(p, args);
    return { flowId: g.id, canvasUrl: canvasUrl(g.id), revision: g.revision, draft: compact(g.draft), ...building(g.issues) };
  });

  tool('flow_get', 'Read a flow: its draft nodes and edges, revision, latest published version and validation issues.', { flowId: FlowId }, async ({ flowId }) => {
    const g = await graphs.get(p, flowId);
    return { flowId: g.id, canvasUrl: canvasUrl(g.id), title: g.title, description: g.description, revision: g.revision, latestVersion: g.latestVersion, draft: compact(g.draft), issues: g.issues };
  });

  tool('flow_update', 'Change the title or description of a flow.', {
    flowId: FlowId,
    title: z.string().min(1).max(120).optional(),
    description: z.string().optional(),
  }, async ({ flowId, ...meta }) => {
    const g = await graphs.updateMeta(p, flowId, meta);
    return { flowId: g.id, title: g.title, description: g.description };
  });

  tool('flow_add_nodes', 'Add one or more nodes. Tool nodes need tool.name from tools_search; argsHint tells the runner where each argument comes from, preferably as {{input.x}} or {{outputKey.field}}.', {
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
  }, async ({ flowId, note }) => ({ ...(await graphs.publish(p, flowId, note)), canvasUrl: canvasUrl(flowId) }));

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
