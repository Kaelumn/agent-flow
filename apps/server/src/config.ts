import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/** AUTH_TOKENS="token:workspace:actor,token2:workspace:actor2" */
const AuthTokens = z
  .string()
  .min(1, 'AUTH_TOKENS is required')
  .transform((raw, ctx) => {
    const tokens = new Map<string, { workspaceId: string; actor: string }>();
    for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [token, workspaceId, actor] = entry.split(':');
      if (!token || !workspaceId || !actor) {
        ctx.addIssue({ code: 'custom', message: `invalid AUTH_TOKENS entry "${entry}", expected token:workspace:actor` });
        return z.NEVER;
      }
      tokens.set(token, { workspaceId, actor });
    }
    return tokens;
  });

const Env = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DB_DIALECT: z.enum(['mysql', 'postgres']).default('mysql'),
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  AUTH_TOKENS: AuthTokens,
  TOOL_CATALOG_PATH: z.string().default(`${packageRoot}data/tool-catalog.json`),
  WEB_DIST: z.string().default(`${packageRoot}../web/dist`),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}
