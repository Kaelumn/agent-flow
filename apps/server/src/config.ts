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

/** EMBED_ORIGINS="https://a.example.com,https://b.example.com" */
const Origins = z
  .string()
  .default('')
  .transform((raw, ctx) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((value) => {
        const origin = URL.canParse(value) ? new URL(value).origin : 'null';
        if (origin === 'null' || origin !== value.replace(/\/$/, '')) ctx.addIssue({ code: 'custom', message: `invalid origin "${value}", expected e.g. https://app.example.com` });
        return origin;
      }),
  );

const Env = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DB_DIALECT: z.enum(['mysql', 'postgres']).default('mysql'),
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  AUTH_TOKENS: AuthTokens,
  /** Live tool catalog: a JSON file in the { "mcpServers": { name: { url, headers } } } shape. Takes precedence over TOOL_CATALOG_PATH. */
  TOOL_SERVERS_CONFIG: z.string().optional(),
  /** Static tool catalog, for offline development and tests. */
  TOOL_CATALOG_PATH: z.string().default(`${packageRoot}data/tool-catalog.json`),
  WEB_DIST: z.string().default(`${packageRoot}../web/dist`),
  /** Base URL of the web app, e.g. https://flows.example.com; lets MCP results link to the canvas. */
  PUBLIC_WEB_URL: z.string().url().optional(),
  /** Pages allowed to embed the canvas and receive its annotations (see docs/integration/canvas-annotations.md). */
  EMBED_ORIGINS: Origins,
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}
