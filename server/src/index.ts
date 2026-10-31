import { app } from './app.js';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { getUserById } from './db/repository.js';
import { runMigrations } from './db/schema.js';
import { seedDemoData } from './db/seed.js';

const db = getDb();

async function start(): Promise<void> {
  await runMigrations(db);
  if (!await getUserById(db, 'user_meena')) await seedDemoData(db);

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
