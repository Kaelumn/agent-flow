import { loadConfig } from '../config.js';
import { createDatabase } from '../db/database.js';
import { migrateToLatest } from '../db/migrations.js';

const db = await createDatabase(loadConfig());
try {
  const results = await migrateToLatest(db);
  for (const r of results) console.log(`${r.status === 'Success' ? 'applied' : r.status}: ${r.migrationName}`);
  if (!results.length) console.log('database is up to date');
} finally {
  await db.destroy();
}
