import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EventBus } from '../common/event-bus.js';
import type { Principal } from '../common/principal.js';

const HEARTBEAT_MS = 15_000;

/** Pushes domain events of the caller's workspace (optionally one flow) as server-sent events. */
export function streamEvents(req: FastifyRequest, reply: FastifyReply, bus: EventBus, principal: Principal, graphId?: string) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const unsubscribe = bus.subscribe((event) => {
    if (event.workspaceId !== principal.workspaceId) return;
    if (graphId && event.graphId !== graphId) return;
    const { workspaceId: _, ...payload } = event;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.raw.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
