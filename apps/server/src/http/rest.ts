import { FeedbackKind, FeedbackStatus, GraphOp } from '@agent-flow/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Principal } from '../common/principal.js';
import type { Services } from '../container.js';
import type { Authenticate } from './auth.js';
import { streamEvents } from './sse.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}

const IdParams = z.object({ id: z.string().min(1) });
const VersionParams = IdParams.extend({ version: z.coerce.number().int().positive() });
const GraphMeta = z.object({ title: z.string().trim().min(1).max(120), description: z.string().max(4000).optional() });
const EditBody = z.object({ ops: z.array(GraphOp).min(1), expectedRevision: z.number().int().optional() });
const FeedbackBody = z.object({ nodeId: z.string().nullable().optional(), kind: FeedbackKind, text: z.string().trim().min(1).max(4000) });
const FeedbackQuery = z.object({ status: z.string().optional() });
const ToolsQuery = z.object({ q: z.string().optional(), connector: z.string().optional() });
const EventsQuery = z.object({ graphId: z.string().optional() });

/** Canvas-facing API. Every write goes through the same services the agent uses over MCP. */
export async function restRoutes(app: FastifyInstance, { services, authenticate }: { services: Services; authenticate: Authenticate }) {
  const { graphs, feedback, runs, tools } = services;

  app.decorateRequest('principal', null as unknown as Principal);
  app.addHook('onRequest', async (req) => {
    req.principal = authenticate(req, 'web');
  });

  app.get('/me', async (req) => ({ workspaceId: req.principal.workspaceId, actor: req.principal.actor }));
  app.get('/tools', async (req) => {
    const { q, connector } = ToolsQuery.parse(req.query);
    return tools.list({ query: q, connector });
  });

  app.get('/graphs', async (req) => graphs.list(req.principal));
  app.post('/graphs', async (req, reply) => reply.code(201).send(await graphs.create(req.principal, GraphMeta.parse(req.body))));
  app.get('/graphs/:id', async (req) => graphs.get(req.principal, IdParams.parse(req.params).id));
  app.patch('/graphs/:id', async (req) => graphs.updateMeta(req.principal, IdParams.parse(req.params).id, GraphMeta.partial().parse(req.body)));
  app.delete('/graphs/:id', async (req, reply) => {
    await graphs.archive(req.principal, IdParams.parse(req.params).id);
    return reply.code(204).send();
  });

  app.post('/graphs/:id/ops', async (req) => {
    const { ops, expectedRevision } = EditBody.parse(req.body);
    return graphs.edit(req.principal, IdParams.parse(req.params).id, ops, expectedRevision);
  });
  app.post('/graphs/:id/publish', async (req) => {
    const { note } = z.object({ note: z.string().max(2000).default('') }).parse(req.body ?? {});
    return graphs.publish(req.principal, IdParams.parse(req.params).id, note);
  });
  app.get('/graphs/:id/versions', async (req) => graphs.listVersions(req.principal, IdParams.parse(req.params).id));
  app.get('/graphs/:id/versions/:version', async (req) => {
    const { id, version } = VersionParams.parse(req.params);
    return graphs.getVersion(req.principal, id, version);
  });
  app.post('/graphs/:id/versions/:version/restore', async (req) => {
    const { id, version } = VersionParams.parse(req.params);
    return graphs.restoreVersion(req.principal, id, version);
  });
  app.get('/graphs/:id/history', async (req) => graphs.history(req.principal, IdParams.parse(req.params).id));

  app.get('/graphs/:id/feedback', async (req) => {
    const { status } = FeedbackQuery.parse(req.query);
    const statuses = status ? z.array(FeedbackStatus).parse(status.split(',')) : undefined;
    return feedback.list(req.principal, IdParams.parse(req.params).id, statuses);
  });
  app.post('/graphs/:id/feedback', async (req, reply) =>
    reply.code(201).send(await feedback.create(req.principal, IdParams.parse(req.params).id, FeedbackBody.parse(req.body))),
  );
  app.post('/feedback/:id/answer', async (req) => {
    const { answer } = z.object({ answer: z.string().trim().min(1).max(4000) }).parse(req.body);
    return feedback.answer(req.principal, IdParams.parse(req.params).id, answer);
  });
  app.post('/feedback/:id/status', async (req) => {
    const { status } = z.object({ status: z.enum(['open', 'resolved']) }).parse(req.body);
    return feedback.setStatus(req.principal, IdParams.parse(req.params).id, status);
  });

  app.get('/graphs/:id/runs', async (req) => runs.list(req.principal, IdParams.parse(req.params).id));
  app.get('/runs/:id', async (req) => runs.get(req.principal, IdParams.parse(req.params).id));
  app.post('/runs/:id/cancel', async (req) => runs.cancel(req.principal, IdParams.parse(req.params).id));

  app.get('/events', async (req, reply) => {
    const { graphId } = EventsQuery.parse(req.query);
    streamEvents(req, reply, services.events, req.principal, graphId);
  });
}
