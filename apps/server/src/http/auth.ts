import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/errors.js';
import type { Principal } from '../common/principal.js';
import type { Config } from '../config.js';

export type Authenticate = (request: FastifyRequest, source: Principal['source']) => Principal;

/** Static bearer tokens from configuration. Replace with an identity provider for production tenants. */
export function tokenAuthenticator(tokens: Config['AUTH_TOKENS']): Authenticate {
  const entries = [...tokens.entries()].map(([token, identity]) => ({ token: Buffer.from(token), identity }));
  return (request, source) => {
    const header = request.headers.authorization;
    const presented = header?.startsWith('Bearer ') ? Buffer.from(header.slice(7).trim()) : null;
    const match = presented && entries.find((e) => e.token.length === presented.length && timingSafeEqual(e.token, presented));
    if (!match) throw new AppError(401, 'unauthorized', 'missing or invalid bearer token');
    return { ...match.identity, source };
  };
}
