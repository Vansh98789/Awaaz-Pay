import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {
  syncTransactionToNeon,
  syncLedgerToNeon,
  syncAuditToNeon,
} from './neon.js';
import type {
  AuditEvent,
  Contact,
  Guardian,
  Invoice,
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

  syncLedgerToNeon({
    id: record.id,
    user_id: record.user_id,
    direction: record.delta >= 0 ? 'credit' : 'debit',
    amount: Math.abs(record.delta),
    balance_after: getBalance(db, record.user_id),
    reason: record.reason,
    created_at: record.created_at,
  }).catch(() => {});

  return record;
}

export function recordTransaction(
  db: Database.Database,
  tx: Omit<Transaction, 'id' | 'created_at' | 'paypal_ref'> & {
    id?: string;
    created_at?: string;
    paypal_ref?: string | null;
  }
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

  syncTransactionToNeon(record).catch(() => {});

  return record;
}

export function getTransactionById(db: Database.Database, id: string): Transaction | null {
  const stmt = db.prepare<[string], Transaction>('SELECT * FROM transactions WHERE id = ?');
  return stmt.get(id) ?? null;
}

export function updateTransactionStatus(
  db: Database.Database,
  id: string,
  status: string,
  paypalRef?: string | null
): void {
  if (paypalRef !== undefined) {
    db.prepare('UPDATE transactions SET status = ?, paypal_ref = ? WHERE id = ?').run(
      status,
      paypalRef,
      id
    );
  } else {
    db.prepare('UPDATE transactions SET status = ? WHERE id = ?').run(status, id);
  }

  const updatedTx = getTransactionById(db, id);
  if (updatedTx) {
    syncTransactionToNeon(updatedTx).catch(() => {});
  }
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

  syncAuditToNeon(record).catch(() => {});

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

export function hasLedgerRef(db: Database.Database, ref: string): boolean {
  const stmt = db.prepare<[string], { count: number }>(
    'SELECT COUNT(*) AS count FROM wallet_ledger WHERE ref = ?'
  );
  return (stmt.get(ref)?.count ?? 0) > 0;
}

export function createNotification(
  db: Database.Database,
  notification: Omit<import('./types.js').Notification, 'id' | 'created_at' | 'delivered'> & {
    id?: string;
    delivered?: number;
    created_at?: string;
  }
): import('./types.js').Notification {
  const record: import('./types.js').Notification = {
    id: notification.id || crypto.randomUUID(),
    user_id: notification.user_id,
    kind: notification.kind,
    message: notification.message,
    spoken_text: notification.spoken_text,
    delivered: notification.delivered ?? 0,
    created_at: notification.created_at || new Date().toISOString(),
  };

  const stmt = db.prepare(`
    INSERT INTO notifications (id, user_id, kind, message, spoken_text, delivered, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.id,
    record.user_id,
    record.kind,
    record.message,
    record.spoken_text,
    record.delivered,
    record.created_at
  );
  return record;
}

export function getPendingNotifications(
  db: Database.Database,
  userId: string
): import('./types.js').Notification[] {
  const stmt = db.prepare<[string], import('./types.js').Notification>(
    'SELECT * FROM notifications WHERE user_id = ? AND delivered = 0 ORDER BY created_at ASC'
  );
  return stmt.all(userId);
}

export function markNotificationDelivered(db: Database.Database, id: string): void {
  const stmt = db.prepare('UPDATE notifications SET delivered = 1 WHERE id = ?');
  stmt.run(id);
}

export function markNotificationsDelivered(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  const stmt = db.prepare(`UPDATE notifications SET delivered = 1 WHERE id IN (${placeholders})`);
  stmt.run(...ids);
}

export function savePasskey(
  db: Database.Database,
  passkey: import('./types.js').Passkey
): import('./types.js').Passkey {
  const stmt = db.prepare(`
    INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      counter = excluded.counter,
      device_type = excluded.device_type,
      backed_up = excluded.backed_up,
      transports = excluded.transports
  `);
  stmt.run(
    passkey.id,
    passkey.user_id,
    passkey.public_key,
    passkey.counter,
    passkey.device_type,
    passkey.backed_up,
    passkey.transports,
    passkey.created_at
  );
  return passkey;
}

export function getPasskeysByUserId(
  db: Database.Database,
  userId: string
): import('./types.js').Passkey[] {
  const stmt = db.prepare<[string], import('./types.js').Passkey>(
    'SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC'
  );
  return stmt.all(userId);
}

export function getPasskeyById(
  db: Database.Database,
  id: string
): import('./types.js').Passkey | null {
  const stmt = db.prepare<[string], import('./types.js').Passkey>(
    'SELECT * FROM passkeys WHERE id = ?'
  );
  return stmt.get(id) ?? null;
}

export function updatePasskeyCounter(
  db: Database.Database,
  id: string,
  counter: number
): void {
  const stmt = db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?');
  stmt.run(counter, id);
}

export function createApproval(
  db: Database.Database,
  approval: Omit<import('./types.js').Approval, 'id'> & { id?: string }
): import('./types.js').Approval {
  const record: import('./types.js').Approval = {
    id: approval.id || crypto.randomUUID(),
    transaction_id: approval.transaction_id,
    guardian_id: approval.guardian_id,
    token: approval.token,
    status: approval.status,
    created_at: approval.created_at || new Date().toISOString(),
    expires_at: approval.expires_at || null,
    decided_at: approval.decided_at ?? null,
  };

  const stmt = db.prepare(`
    INSERT INTO approvals (id, transaction_id, guardian_id, token, status, created_at, expires_at, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    record.id,
    record.transaction_id,
    record.guardian_id,
    record.token,
    record.status,
    record.created_at,
    record.expires_at,
    record.decided_at
  );
  return record;
}

export function getApprovalByToken(
  db: Database.Database,
  token: string
): import('./types.js').Approval | null {
  const stmt = db.prepare<[string], import('./types.js').Approval>(
    'SELECT * FROM approvals WHERE token = ?'
  );
  return stmt.get(token) ?? null;
}

export function getApprovalByTransactionId(
  db: Database.Database,
  transactionId: string
): import('./types.js').Approval | null {
  const stmt = db.prepare<[string], import('./types.js').Approval>(
    'SELECT * FROM approvals WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 1'
  );
  return stmt.get(transactionId) ?? null;
}

export function updateApprovalStatus(
  db: Database.Database,
  token: string,
  status: string,
  decidedAt = new Date().toISOString()
): void {
  const stmt = db.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE token = ?');
  stmt.run(status, decidedAt, token);
}

export function getContactById(
  db: Database.Database,
  id: string
): import('./types.js').Contact | null {
  const stmt = db.prepare<[string], import('./types.js').Contact>(
    'SELECT * FROM contacts WHERE id = ?'
  );
  return stmt.get(id) ?? null;
}

export function deleteContact(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

export function createInvoiceRecord(
  db: Database.Database,
  invoice: Omit<Invoice, 'id'> & { id?: string }
): Invoice {
  const record: Invoice = {
    id: invoice.id || crypto.randomUUID(),
    merchant_id: invoice.merchant_id,
    paypal_invoice_id: invoice.paypal_invoice_id,
    amount: invoice.amount,
    currency: invoice.currency || 'USD',
    status: invoice.status || 'SENT',
  };

  const stmt = db.prepare(`
    INSERT INTO invoices (id, merchant_id, paypal_invoice_id, amount, currency, status)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      amount = excluded.amount
  `);

  stmt.run(
    record.id,
    record.merchant_id,
    record.paypal_invoice_id,
    record.amount,
    record.currency,
    record.status
  );

  return record;
}

export interface InvoiceWithMerchant extends Invoice {
  merchant_name: string;
  merchant_email: string;
  merchant_verified: number;
}

export function getInvoiceByPaypalId(
  db: Database.Database,
  paypalInvoiceId: string
): InvoiceWithMerchant | null {
  const stmt = db.prepare<[string], InvoiceWithMerchant>(`
    SELECT i.*, m.name as merchant_name, m.paypal_email as merchant_email, m.verified as merchant_verified
    FROM invoices i
    JOIN merchants m ON i.merchant_id = m.id
    WHERE i.paypal_invoice_id = ?
    LIMIT 1
  `);
  return stmt.get(paypalInvoiceId) ?? null;
}

export function getInvoiceById(
  db: Database.Database,
  id: string
): InvoiceWithMerchant | null {
  const stmt = db.prepare<[string], InvoiceWithMerchant>(`
    SELECT i.*, m.name as merchant_name, m.paypal_email as merchant_email, m.verified as merchant_verified
    FROM invoices i
    JOIN merchants m ON i.merchant_id = m.id
    WHERE i.id = ?
    LIMIT 1
  `);
  return stmt.get(id) ?? null;
}

export function updateInvoiceStatus(
  db: Database.Database,
  idOrPaypalId: string,
  status: string
): void {
  db.prepare(`
    UPDATE invoices
    SET status = ?
    WHERE id = ? OR paypal_invoice_id = ?
  `).run(status, idOrPaypalId, idOrPaypalId);
}

export function getMerchantById(
  db: Database.Database,
  id: string
): Merchant | null {
  const stmt = db.prepare<[string], Merchant>(
    'SELECT * FROM merchants WHERE id = ?'
  );
  return stmt.get(id) ?? null;
}
