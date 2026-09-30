import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './container.js';
import { createDatabase } from './db/database.js';
import { tokenAuthenticator } from './http/auth.js';
import { StaticToolCatalog } from './services/tool-catalog.js';

const config = loadConfig();
const db = await createDatabase(config);
const tools = await StaticToolCatalog.fromFile(config.TOOL_CATALOG_PATH);
const app = await buildApp({ config, db, services: createServices(db, tools), authenticate: tokenAuthenticator(config.AUTH_TOKENS) });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
