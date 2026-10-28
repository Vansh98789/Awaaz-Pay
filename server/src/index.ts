import { app } from './app.js';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { getUserById } from './db/repository.js';
import { runMigrations } from './db/schema.js';
import { seedDemoData } from './db/seed.js';

// Initialize SQLite database and execute schema migrations at startup
const db = getDb();
runMigrations(db);

// Auto-seed demo persona if missing (essential for Render free-tier container restarts)
if (!getUserById(db, 'user_meena')) {
  seedDemoData(db);
  console.log('[Awaaz Pay Server] auto-seeded demo records (Meena, Ramesh, contacts, merchant)');
}

// Bind to port specified in environment config and display public webhook URL
app.listen(config.PORT, () => {
  console.log(`[Awaaz Pay Server] listening on port ${config.PORT} (mode: ${config.NODE_ENV})`);
  if (config.PUBLIC_BASE_URL) {
    console.log(`[Awaaz Pay Server] public base URL: ${config.PUBLIC_BASE_URL}`);
  } else {
    console.log(
      '[Awaaz Pay Server] PUBLIC_BASE_URL is not configured (set this in production for PayPal webhook callbacks)'
    );
  }
});
