import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { toAppError } from './common/errors.js';
import type { Config } from './config.js';
import type { Services } from './container.js';
import type { Database } from './db/database.js';
import type { Authenticate } from './http/auth.js';
import { mcpRoutes } from './http/mcp.js';
import { restRoutes } from './http/rest.js';

export interface AppDeps {
  config: Pick<Config, 'LOG_LEVEL' | 'WEB_DIST'>;
  db: Database;
  services: Services;
  authenticate: Authenticate;
}

export async function buildApp({ config, db, services, authenticate }: AppDeps) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, bodyLimit: 2 * 1024 * 1024 });

  app.setErrorHandler((err, req, reply) => {
    const appError = toAppError(err);
    if (appError) return reply.code(appError.status).send({ error: appError.code, message: appError.message, details: appError.details });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'unexpected server error' });
  });

  app.get('/health', async () => {
    await sql`select 1`.execute(db);
    return { status: 'ok' };
  });

  await app.register(restRoutes, { prefix: '/api', services, authenticate });
  await app.register(mcpRoutes, { prefix: '/mcp', services, authenticate });

  if (existsSync(config.WEB_DIST)) {
    await app.register(fastifyStatic, { root: config.WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/mcp')
        ? reply.sendFile('index.html')
        : reply.code(404).send({ error: 'not_found', message: `${req.method} ${req.url} not found` }),
    );
  }

  return app;
}
