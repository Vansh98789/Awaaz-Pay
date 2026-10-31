import { app } from './app.js';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { getUserById } from './db/repository.js';
import { runMigrations } from './db/schema.js';
import { seedDemoData } from './db/seed.js';
import { isNeonConfigured, initNeonDb, syncSqliteSnapshotToNeon } from './db/neon.js';

const db = getDb();
runMigrations(db);

if (!getUserById(db, 'user_meena')) {
  seedDemoData(db);
}

async function start(): Promise<void> {
  if (isNeonConfigured()) {
    const initialized = await initNeonDb();
    if (!initialized) throw new Error('Neon is configured but could not be initialized.');
    await syncSqliteSnapshotToNeon(db);

    // SQLite remains the app's live database; periodically reconcile the full
    // snapshot so writes from every route, including direct SQL updates, reach Neon.
    let syncing = false;
    const mirrorTimer = setInterval(() => {
      if (syncing) return;
      syncing = true;
      void syncSqliteSnapshotToNeon(db)
        .catch((err) => console.warn('[Neon DB] Snapshot sync failed:', (err as Error).message))
        .finally(() => { syncing = false; });
    }, 15_000);
    mirrorTimer.unref();
  }

  app.listen(config.PORT, () => {
    console.log(`[Awaaz Pay] running on port ${config.PORT} (${config.NODE_ENV})`);
    if (config.PUBLIC_BASE_URL) {
      console.log(`[Awaaz Pay] public URL: ${config.PUBLIC_BASE_URL}`);
    }
  });
}

void start().catch((err) => {
  console.error('[Awaaz Pay] Startup failed:', (err as Error).message);
  process.exitCode = 1;
});
