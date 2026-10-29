import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type {
  AuditEvent,
  Contact,
  Guardian,
  LedgerEntry,
  Merchant,
  Transaction,
  User,
} from './types.js';

export function getUserById(db: Database.Database, id: string): User | null {
  const stmt = db.prepare<[string], User>('SELECT * FROM users WHERE id = ?');
  return stmt.get(id) ?? null;
}

export function listContacts(db: Database.Database, userId: string): Contact[] {
  const stmt = db.prepare<[string], Contact>(
    'SELECT * FROM contacts WHERE user_id = ? ORDER BY alias ASC'
  );
  return stmt.all(userId);
}

export function getBalance(db: Database.Database, userId: string): number {
  const stmt = db.prepare<[string], { balance: number }>(
    'SELECT COALESCE(SUM(delta), 0) AS balance FROM wallet_ledger WHERE user_id = ?'
  );
  const result = stmt.get(userId);
  return result?.balance ?? 0;
}

export function addLedgerEntry(
  db: Database.Database,
  entry: Omit<LedgerEntry, 'id' | 'created_at'> & { id?: string; created_at?: string }
): LedgerEntry {
  const record: LedgerEntry = {
    id: entry.id || crypto.randomUUID(),
    user_id: entry.user_id,
    delta: entry.delta,
    reason: entry.reason,
    ref: entry.ref ?? null,
    created_at: entry.created_at || new Date().toISOString(),
  };

  const stmt = db.prepare(
    'INSERT INTO wallet_ledger (id, user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(
    record.id,
    record.user_id,
    record.delta,
    record.reason,
    record.ref,
    record.created_at
  );
  return record;
}

export function recordTransaction(
  db: Database.Database,
  tx: Omit<Transaction, 'id' | 'created_at'> & { id?: string; created_at?: string }
): Transaction {
  const record: Transaction = {
    id: tx.id || crypto.randomUUID(),
    user_id: tx.user_id,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    counterparty_type: tx.counterparty_type,
    counterparty_id: tx.counterparty_id,
    tier: tx.tier,
    risk_score: tx.risk_score,
    decision: tx.decision,
    status: tx.status,
    paypal_ref: tx.paypal_ref ?? null,
    created_at: tx.created_at || new Date().toISOString(),
  };

  const stmt = db.prepare(`
    INSERT INTO transactions (
      id, user_id, type, amount, currency, counterparty_type,
      counterparty_id, tier, risk_score, decision, status, paypal_ref, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.id,
    record.user_id,
    record.type,
    record.amount,
    record.currency,
    record.counterparty_type,
    record.counterparty_id,
    record.tier,
    record.risk_score,
    record.decision,
    record.status,
    record.paypal_ref,
    record.created_at
  );

  return record;
}

export function writeAudit(
  db: Database.Database,
  event: Omit<AuditEvent, 'id' | 'created_at'> & { id?: string; created_at?: string }
): AuditEvent {
  const record: AuditEvent = {
    id: event.id || crypto.randomUUID(),
    user_id: event.user_id,
    kind: event.kind,
    payload: event.payload,
    created_at: event.created_at || new Date().toISOString(),
  };

  const stmt = db.prepare(
    'INSERT INTO audit_events (id, user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(
    record.id,
    record.user_id,
    record.kind,
    record.payload,
    record.created_at
  );
  return record;
}

export function upsertUser(db: Database.Database, user: User): User {
  const stmt = db.prepare(`
    INSERT INTO users (id, name, language, limits, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      language = excluded.language,
      limits = excluded.limits
  `);
  stmt.run(user.id, user.name, user.language, user.limits, user.created_at);
  return user;
}

export function upsertGuardian(db: Database.Database, guardian: Guardian): Guardian {
  const stmt = db.prepare(`
    INSERT INTO guardians (id, user_id, name, contact, permissions)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      contact = excluded.contact,
      permissions = excluded.permissions
  `);
  stmt.run(
    guardian.id,
    guardian.user_id,
    guardian.name,
    guardian.contact,
    guardian.permissions
  );
  return guardian;
}

export function upsertContact(db: Database.Database, contact: Contact): Contact {
  const stmt = db.prepare(`
    INSERT INTO contacts (id, user_id, alias, display_name, paypal_email, status, added_by, activated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      alias = excluded.alias,
      display_name = excluded.display_name,
      paypal_email = excluded.paypal_email,
      status = excluded.status,
      activated_at = excluded.activated_at
  `);
  stmt.run(
    contact.id,
    contact.user_id,
    contact.alias,
    contact.display_name,
    contact.paypal_email,
    contact.status,
    contact.added_by,
    contact.activated_at
  );
  return contact;
}

export function upsertMerchant(db: Database.Database, merchant: Merchant): Merchant {
  const stmt = db.prepare(`
    INSERT INTO merchants (id, name, paypal_email, verified)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      paypal_email = excluded.paypal_email,
      verified = excluded.verified
  `);
  stmt.run(merchant.id, merchant.name, merchant.paypal_email, merchant.verified);
  return merchant;
}
