import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

let sqlClient: NeonQueryFunction<false, false> | null = null;

export function isNeonConfigured(): boolean {
  const url = process.env['DATABASE_URL'];
  return !!(url && (url.startsWith('postgres://') || url.startsWith('postgresql://')));
}

export function getNeonSql(): NeonQueryFunction<false, false> | null {
  if (!isNeonConfigured()) return null;
  if (!sqlClient) {
    const url = process.env['DATABASE_URL']!;
    sqlClient = neon(url);
  }
  return sqlClient;
}

export async function initNeonDb(): Promise<boolean> {
  const sql = getNeonSql();
  if (!sql) {
    return false;
  }

  try {
    console.log('[Neon DB] Initializing PostgreSQL schema on Neon...');

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        language VARCHAR(10) DEFAULT 'en',
        limits JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        amount NUMERIC NOT NULL,
        currency VARCHAR(8) DEFAULT 'USD',
        counterparty_type VARCHAR(32),
        counterparty_id VARCHAR(128),
        tier INT DEFAULT 1,
        risk_score NUMERIC DEFAULT 0,
        decision VARCHAR(32),
        status VARCHAR(32),
        paypal_ref VARCHAR(128),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS wallet_ledger (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        direction VARCHAR(8) NOT NULL,
        amount NUMERIC NOT NULL,
        balance_after NUMERIC NOT NULL,
        reason VARCHAR(256),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS audit_events (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        kind VARCHAR(64) NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    console.log('[Neon DB] Schema synchronized successfully.');
    return true;
  } catch (err) {
    console.warn('[Neon DB] Failed to initialize Neon schema:', (err as Error).message);
    return false;
  }
}

export async function syncTransactionToNeon(tx: {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  currency?: string;
  counterparty_type?: string;
  counterparty_id?: string;
  tier?: number;
  risk_score?: number;
  decision?: string;
  status?: string;
  paypal_ref?: string | null;
  created_at?: string;
}): Promise<void> {
  const sql = getNeonSql();
  if (!sql) return;

  try {
    await sql`
      INSERT INTO transactions (
        id, user_id, type, amount, currency,
        counterparty_type, counterparty_id, tier,
        risk_score, decision, status, paypal_ref, created_at
      ) VALUES (
        ${tx.id}, ${tx.user_id}, ${tx.type}, ${tx.amount}, ${tx.currency || 'USD'},
        ${tx.counterparty_type || null}, ${tx.counterparty_id || null}, ${tx.tier ?? 1},
        ${tx.risk_score ?? 0}, ${tx.decision || 'allow'}, ${tx.status || 'completed'},
        ${tx.paypal_ref || null}, ${tx.created_at || new Date().toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        paypal_ref = EXCLUDED.paypal_ref;
    `;
    console.log(`[Neon DB] Transaction ${tx.id} synced.`);
  } catch (err) {
    console.warn(`[Neon DB] Transaction sync failed:`, (err as Error).message);
  }
}

export async function syncLedgerToNeon(entry: {
  id: string;
  user_id: string;
  direction: 'credit' | 'debit';
  amount: number;
  balance_after: number;
  reason: string;
  created_at?: string;
}): Promise<void> {
  const sql = getNeonSql();
  if (!sql) return;

  try {
    await sql`
      INSERT INTO wallet_ledger (
        id, user_id, direction, amount, balance_after, reason, created_at
      ) VALUES (
        ${entry.id}, ${entry.user_id}, ${entry.direction}, ${entry.amount},
        ${entry.balance_after}, ${entry.reason}, ${entry.created_at || new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    console.log(`[Neon DB] Ledger entry ${entry.id} synced.`);
  } catch (err) {
    console.warn(`[Neon DB] Ledger sync failed:`, (err as Error).message);
  }
}

export async function syncAuditToNeon(event: {
  id: string;
  user_id: string;
  kind: string;
  payload: string;
  created_at?: string;
}): Promise<void> {
  const sql = getNeonSql();
  if (!sql) return;

  try {
    let jsonPayload: unknown = {};
    try {
      jsonPayload = JSON.parse(event.payload);
    } catch {
      jsonPayload = { text: event.payload };
    }

    await sql`
      INSERT INTO audit_events (
        id, user_id, kind, payload, created_at
      ) VALUES (
        ${event.id}, ${event.user_id}, ${event.kind},
        ${JSON.stringify(jsonPayload)}, ${event.created_at || new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING;
    `;
  } catch (err) {
    console.warn(`[Neon DB] Audit sync failed:`, (err as Error).message);
  }
}
