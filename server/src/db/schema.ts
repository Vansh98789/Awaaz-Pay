import type { AppDatabase as Database } from './connection.js';

const LEGACY_TABLES = [
  'users', 'guardians', 'merchants', 'contacts', 'invoices', 'transactions',
  'approvals', 'notifications', 'audit_events', 'blocklist', 'wallet_ledger', 'passkeys',
] as const;

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'hi', limits JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS guardians (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, contact TEXT NOT NULL, permissions TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, alias TEXT NOT NULL, display_name TEXT NOT NULL, paypal_email TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('cooling_off', 'active')), added_by TEXT NOT NULL, activated_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS merchants (id TEXT PRIMARY KEY, name TEXT NOT NULL, paypal_email TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE, paypal_invoice_id TEXT NOT NULL, amount NUMERIC NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, amount NUMERIC NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', counterparty_type TEXT NOT NULL, counterparty_id TEXT NOT NULL, tier INTEGER NOT NULL, risk_score NUMERIC NOT NULL, decision TEXT NOT NULL, status TEXT NOT NULL, paypal_ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, decided_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, message TEXT NOT NULL, spoken_text TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS blocklist (id TEXT PRIMARY KEY, paypal_email TEXT NOT NULL UNIQUE, reason TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wallet_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, delta NUMERIC NOT NULL DEFAULT 0, reason TEXT NOT NULL, ref TEXT, direction TEXT, amount NUMERIC, balance_after NUMERIC, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter BIGINT NOT NULL DEFAULT 0, device_type TEXT DEFAULT 'singleDevice', backed_up INTEGER DEFAULT 0, transports TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sqlite_mirror (table_name TEXT NOT NULL, record_id TEXT NOT NULL, data JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (table_name, record_id))`,
  `CREATE TABLE IF NOT EXISTS app_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_user_alias ON contacts(user_id, alias)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_user ON wallet_ledger(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_transaction ON approvals(transaction_id, created_at DESC)`,
];

const MIRROR_COLUMNS: Record<(typeof LEGACY_TABLES)[number], string[]> = {
  users: ['id', 'name', 'language', 'limits', 'created_at'],
  guardians: ['id', 'user_id', 'name', 'contact', 'permissions'],
  merchants: ['id', 'name', 'paypal_email', 'verified'],
  contacts: ['id', 'user_id', 'alias', 'display_name', 'paypal_email', 'status', 'added_by', 'activated_at'],
  invoices: ['id', 'merchant_id', 'paypal_invoice_id', 'amount', 'currency', 'status'],
  transactions: ['id', 'user_id', 'type', 'amount', 'currency', 'counterparty_type', 'counterparty_id', 'tier', 'risk_score', 'decision', 'status', 'paypal_ref', 'created_at'],
  approvals: ['id', 'transaction_id', 'guardian_id', 'token', 'status', 'created_at', 'expires_at', 'decided_at'],
  notifications: ['id', 'user_id', 'kind', 'message', 'spoken_text', 'delivered', 'created_at'],
  audit_events: ['id', 'user_id', 'kind', 'payload', 'created_at'],
  blocklist: ['id', 'paypal_email', 'reason'],
  wallet_ledger: ['id', 'user_id', 'delta', 'reason', 'ref', 'direction', 'amount', 'balance_after', 'created_at'],
  passkeys: ['id', 'user_id', 'public_key', 'counter', 'device_type', 'backed_up', 'transports', 'created_at'],
};

/** Create the live PostgreSQL schema and safely import the old mirrored SQLite snapshot once. */
export async function runMigrations(db: Database): Promise<void> {
  for (const statement of CREATE_STATEMENTS) await db.query(statement);

  // Older deployed schemas had this ledger shape. Keep its old columns usable,
  // while the application now reads and writes the canonical signed delta.
  await db.query('ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS delta NUMERIC NOT NULL DEFAULT 0');
  await db.query('ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS ref TEXT');
  await db.query("UPDATE wallet_ledger SET delta = CASE WHEN direction = 'debit' THEN -COALESCE(amount, 0) ELSE COALESCE(amount, 0) END WHERE delta = 0 AND COALESCE(amount, 0) <> 0");

  // Import rows captured by the former SQLite-to-Neon mirror without replacing
  // any data already written directly to the canonical Neon tables.
  const migration = 'sqlite_mirror_to_neon_v1';
  const migrationDone = (await db.query<{ version: string }>('SELECT version FROM app_migrations WHERE version = $1', [migration])).length > 0;
  if (!migrationDone) {
    const mirror = await db.query<{ table_name: string; data: Record<string, unknown> }>(
      'SELECT table_name, data FROM sqlite_mirror ORDER BY table_name, record_id',
    );
    const order = new Map(LEGACY_TABLES.map((table, i) => [table, i]));
    mirror.sort((a, b) => (order.get(a.table_name as (typeof LEGACY_TABLES)[number]) ?? 99) - (order.get(b.table_name as (typeof LEGACY_TABLES)[number]) ?? 99));
    for (const item of mirror) {
      if (!Object.hasOwn(MIRROR_COLUMNS, item.table_name)) continue;
      const table = item.table_name as (typeof LEGACY_TABLES)[number];
      const columns = MIRROR_COLUMNS[table].filter((column) =>
        Object.hasOwn(item.data, column) || table === 'wallet_ledger' && ['direction', 'amount', 'balance_after'].includes(column),
      );
      if (!columns.length) continue;
      const values = columns.map((column) => {
        if (table === 'wallet_ledger') {
          const delta = Number(item.data['delta'] ?? 0);
          if (column === 'direction') return delta < 0 ? 'debit' : 'credit';
          if (column === 'amount') return Math.abs(delta);
          if (column === 'balance_after') return 0;
        }
        return item.data[column];
      });
      const placeholders = columns.map((_, index) => `$${index + 1}${table === 'users' && columns[index] === 'limits' || table === 'audit_events' && columns[index] === 'payload' ? '::jsonb' : ''}`);
      await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`, values);
    }
    await db.query('INSERT INTO app_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [migration]);
  }

  // The old app stored the demo's INR examples; retain the prior one-time conversion.
  await db.query("UPDATE transactions SET amount = ROUND(amount * 0.012, 2), currency = 'USD' WHERE currency = 'INR'");
  await db.query("UPDATE invoices SET amount = ROUND(amount * 0.012, 2), currency = 'USD' WHERE currency = 'INR'");
  await db.query(`UPDATE users SET limits = jsonb_set(limits, '{daily_total}', '5000'::jsonb)
    WHERE id = 'user_meena' AND jsonb_typeof(limits) = 'object' AND limits->>'daily_total' = '1000'`);
}
