import { loadConfig } from '../config.js';
import { createServices } from '../container.js';
import { createDatabase } from '../db/database.js';
import { loadToolCatalog } from '../services/tool-catalog.js';
import { onboardingTemplate } from './templates/onboarding.js';

/** Seeds the built-in templates into the workspace of the first configured token. Idempotent by title. */
const config = loadConfig();
const [identity] = config.AUTH_TOKENS.values();
const principal = { workspaceId: identity!.workspaceId, actor: 'seed', source: 'web' as const };

const db = await createDatabase(config);
try {
  const { graphs } = createServices(db, await loadToolCatalog(config));
  const existing = await graphs.list(principal);

  for (const template of [onboardingTemplate]) {
    if (existing.some((g) => g.title === template.title)) {
      console.log(`skipped (exists): ${template.title}`);
      continue;
    }
    const graph = await graphs.create(principal, template);
    await graphs.edit(principal, graph.id, template.ops);
    const { version } = await graphs.publish(principal, graph.id, 'Initial template');
    console.log(`seeded: ${template.title} (${graph.id}) v${version}`);
  }
} finally {
  await db.destroy();
  process.exit(); // the live catalog keeps a refresh timer
}
