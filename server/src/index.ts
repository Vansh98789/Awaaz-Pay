import { app } from './app.js';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { getUserById } from './db/repository.js';
import { runMigrations } from './db/schema.js';
import { seedDemoData } from './db/seed.js';
import { isNeonConfigured, initNeonDb } from './db/neon.js';

const db = getDb();
runMigrations(db);

if (!getUserById(db, 'user_meena')) {
  seedDemoData(db);
}

if (isNeonConfigured()) {
  initNeonDb().catch((err) =>
    console.warn('[Neon DB] Background init failed:', (err as Error).message)
  );
}

app.listen(config.PORT, () => {
  console.log(`[Awaaz Pay] running on port ${config.PORT} (${config.NODE_ENV})`);
  if (config.PUBLIC_BASE_URL) {
    console.log(`[Awaaz Pay] public URL: ${config.PUBLIC_BASE_URL}`);
  }
});
