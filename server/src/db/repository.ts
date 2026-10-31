import crypto from 'node:crypto';
import type { AppDatabase as Database } from './connection.js';
import type {
  AuditEvent, Contact, Guardian, Invoice, LedgerEntry, Merchant, Transaction, User,
} from './types.js';

const rows = <T>(db: Database, sql: string, params: unknown[] = []) => db.query<T>(sql, params);
const first = async <T>(db: Database, sql: string, params: unknown[] = []) =>
  (await rows<T>(db, sql, params))[0] ?? null;
const textJson = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value ?? {});
const normalizeUser = (user: User | null): User | null => user ? { ...user, limits: textJson(user.limits) } : null;

export async function getUserById(db: Database, id: string): Promise<User | null> {
  return normalizeUser(await first<User>(db, 'SELECT * FROM users WHERE id = $1', [id]));
}

export async function listContacts(db: Database, userId: string): Promise<Contact[]> {
  return rows<Contact>(db, 'SELECT * FROM contacts WHERE user_id = $1 ORDER BY alias ASC', [userId]);
}

export async function getBalance(db: Database, userId: string): Promise<number> {
  const result = await first<{ balance: number | string }>(db, 'SELECT COALESCE(SUM(delta), 0) AS balance FROM wallet_ledger WHERE user_id = $1', [userId]);
  return Number(result?.balance ?? 0);
}

export async function addLedgerEntry(db: Database, entry: Omit<LedgerEntry, 'id' | 'created_at'> & { id?: string; created_at?: string }): Promise<LedgerEntry> {
  const record: LedgerEntry = { ...entry, id: entry.id || crypto.randomUUID(), ref: entry.ref ?? null, created_at: entry.created_at || new Date().toISOString() };
  const balanceAfter = await getBalance(db, record.user_id) + record.delta;
  await db.query(`INSERT INTO wallet_ledger (id, user_id, delta, reason, ref, direction, amount, balance_after, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [record.id, record.user_id, record.delta, record.reason, record.ref, record.delta < 0 ? 'debit' : 'credit', Math.abs(record.delta), balanceAfter, record.created_at]);
  return record;
}

export async function recordTransaction(db: Database, tx: Omit<Transaction, 'id' | 'created_at' | 'paypal_ref'> & { id?: string; created_at?: string; paypal_ref?: string | null }): Promise<Transaction> {
  const record: Transaction = { ...tx, id: tx.id || crypto.randomUUID(), paypal_ref: tx.paypal_ref ?? null, created_at: tx.created_at || new Date().toISOString() };
  await db.query(`INSERT INTO transactions (id, user_id, type, amount, currency, counterparty_type, counterparty_id, tier, risk_score, decision, status, paypal_ref, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [record.id, record.user_id, record.type, record.amount, record.currency, record.counterparty_type, record.counterparty_id, record.tier, record.risk_score, record.decision, record.status, record.paypal_ref, record.created_at]);
  return record;
}

export async function getTransactionById(db: Database, id: string): Promise<Transaction | null> {
  const tx = await first<Transaction>(db,
    `SELECT id, user_id, type, amount::float8 AS amount, currency, counterparty_type, counterparty_id,
      tier, risk_score::float8 AS risk_score, decision, status, paypal_ref, created_at
     FROM transactions WHERE id = $1`, [id]);
  return tx ? { ...tx, amount: Number(tx.amount), risk_score: Number(tx.risk_score) } : null;
}

export async function updateTransactionStatus(db: Database, id: string, status: string, paypalRef?: string | null): Promise<void> {
  if (paypalRef !== undefined) await db.query('UPDATE transactions SET status = $1, paypal_ref = $2 WHERE id = $3', [status, paypalRef, id]);
  else await db.query('UPDATE transactions SET status = $1 WHERE id = $2', [status, id]);
}

export async function writeAudit(db: Database, event: Omit<AuditEvent, 'id' | 'created_at'> & { id?: string; created_at?: string }): Promise<AuditEvent> {
  const record: AuditEvent = { ...event, id: event.id || crypto.randomUUID(), created_at: event.created_at || new Date().toISOString() };
  let payload: unknown;
  try { payload = JSON.parse(record.payload); } catch { payload = { text: record.payload }; }
  await db.query('INSERT INTO audit_events (id, user_id, kind, payload, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)', [record.id, record.user_id, record.kind, JSON.stringify(payload), record.created_at]);
  return record;
}

export async function upsertUser(db: Database, user: User): Promise<User> {
  await db.query(`INSERT INTO users (id, name, language, limits, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language = EXCLUDED.language, limits = EXCLUDED.limits`, [user.id, user.name, user.language, user.limits, user.created_at]);
  return user;
}

export async function upsertGuardian(db: Database, guardian: Guardian): Promise<Guardian> {
  await db.query(`INSERT INTO guardians (id, user_id, name, contact, permissions) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, contact = EXCLUDED.contact, permissions = EXCLUDED.permissions`, [guardian.id, guardian.user_id, guardian.name, guardian.contact, guardian.permissions]);
  return guardian;
}

export async function upsertContact(db: Database, contact: Contact): Promise<Contact> {
  await db.query(`INSERT INTO contacts (id, user_id, alias, display_name, paypal_email, status, added_by, activated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET alias = EXCLUDED.alias,
    display_name = EXCLUDED.display_name, paypal_email = EXCLUDED.paypal_email, status = EXCLUDED.status, activated_at = EXCLUDED.activated_at`,
  [contact.id, contact.user_id, contact.alias, contact.display_name, contact.paypal_email, contact.status, contact.added_by, contact.activated_at]);
  return contact;
}

export async function upsertMerchant(db: Database, merchant: Merchant): Promise<Merchant> {
  await db.query(`INSERT INTO merchants (id, name, paypal_email, verified) VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, paypal_email = EXCLUDED.paypal_email, verified = EXCLUDED.verified`, [merchant.id, merchant.name, merchant.paypal_email, merchant.verified]);
  return merchant;
}

export async function hasLedgerRef(db: Database, ref: string): Promise<boolean> {
  const result = await first<{ exists: boolean }>(db, 'SELECT EXISTS (SELECT 1 FROM wallet_ledger WHERE ref = $1) AS exists', [ref]);
  return result?.exists ?? false;
}

export async function createNotification(db: Database, notification: Omit<import('./types.js').Notification, 'id' | 'created_at' | 'delivered'> & { id?: string; delivered?: number; created_at?: string }): Promise<import('./types.js').Notification> {
  const record: import('./types.js').Notification = { ...notification, id: notification.id || crypto.randomUUID(), delivered: notification.delivered ?? 0, created_at: notification.created_at || new Date().toISOString() };
  await db.query(`INSERT INTO notifications (id, user_id, kind, message, spoken_text, delivered, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [record.id, record.user_id, record.kind, record.message, record.spoken_text, record.delivered, record.created_at]);
  return record;
}

export async function getPendingNotifications(db: Database, userId: string): Promise<import('./types.js').Notification[]> {
  return rows(db, 'SELECT * FROM notifications WHERE user_id = $1 AND delivered = 0 ORDER BY created_at ASC', [userId]);
}

export async function markNotificationDelivered(db: Database, id: string): Promise<void> {
  await db.query('UPDATE notifications SET delivered = 1 WHERE id = $1', [id]);
}

export async function markNotificationsDelivered(db: Database, ids: string[]): Promise<void> {
  if (ids.length) await db.query('UPDATE notifications SET delivered = 1 WHERE id = ANY($1::text[])', [ids]);
}

export async function savePasskey(db: Database, passkey: import('./types.js').Passkey): Promise<import('./types.js').Passkey> {
  await db.query(`INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET counter = EXCLUDED.counter,
    device_type = EXCLUDED.device_type, backed_up = EXCLUDED.backed_up, transports = EXCLUDED.transports`,
  [passkey.id, passkey.user_id, passkey.public_key, passkey.counter, passkey.device_type, passkey.backed_up, passkey.transports, passkey.created_at]);
  return passkey;
}

export async function getPasskeysByUserId(db: Database, userId: string): Promise<import('./types.js').Passkey[]> {
  return rows(db, 'SELECT * FROM passkeys WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}

export async function getPasskeyById(db: Database, id: string): Promise<import('./types.js').Passkey | null> {
  return first(db, 'SELECT * FROM passkeys WHERE id = $1', [id]);
}

export async function updatePasskeyCounter(db: Database, id: string, counter: number): Promise<void> {
  await db.query('UPDATE passkeys SET counter = $1 WHERE id = $2', [counter, id]);
}

export async function createApproval(db: Database, approval: Omit<import('./types.js').Approval, 'id'> & { id?: string }): Promise<import('./types.js').Approval> {
  const record: import('./types.js').Approval = { ...approval, id: approval.id || crypto.randomUUID(), created_at: approval.created_at || new Date().toISOString(), expires_at: approval.expires_at || null, decided_at: approval.decided_at ?? null };
  await db.query(`INSERT INTO approvals (id, transaction_id, guardian_id, token, status, created_at, expires_at, decided_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [record.id, record.transaction_id, record.guardian_id, record.token, record.status, record.created_at, record.expires_at, record.decided_at]);
  return record;
}

export async function getApprovalByToken(db: Database, token: string): Promise<import('./types.js').Approval | null> {
  return first(db, 'SELECT * FROM approvals WHERE token = $1', [token]);
}

export async function getApprovalByTransactionId(db: Database, transactionId: string): Promise<import('./types.js').Approval | null> {
  return first(db, 'SELECT * FROM approvals WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1', [transactionId]);
}

export async function updateApprovalStatus(db: Database, token: string, status: string, decidedAt = new Date().toISOString()): Promise<void> {
  await db.query('UPDATE approvals SET status = $1, decided_at = $2 WHERE token = $3', [status, decidedAt, token]);
}

export async function getContactById(db: Database, id: string): Promise<Contact | null> {
  return first(db, 'SELECT * FROM contacts WHERE id = $1', [id]);
}

export async function deleteContact(db: Database, id: string): Promise<void> {
  await db.query('DELETE FROM contacts WHERE id = $1', [id]);
}

export async function createInvoiceRecord(db: Database, invoice: Omit<Invoice, 'id'> & { id?: string }): Promise<Invoice> {
  const record: Invoice = { ...invoice, id: invoice.id || crypto.randomUUID(), currency: invoice.currency || 'USD', status: invoice.status || 'SENT' };
  await db.query(`INSERT INTO invoices (id, merchant_id, paypal_invoice_id, amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, amount = EXCLUDED.amount`, [record.id, record.merchant_id, record.paypal_invoice_id, record.amount, record.currency, record.status]);
  return record;
}

export interface InvoiceWithMerchant extends Invoice { merchant_name: string; merchant_email: string; merchant_verified: number }

const invoiceSelect = `SELECT i.id, i.merchant_id, i.paypal_invoice_id, i.amount::float8 AS amount,
  i.currency, i.status, m.name AS merchant_name, m.paypal_email AS merchant_email, m.verified AS merchant_verified
  FROM invoices i JOIN merchants m ON i.merchant_id = m.id`;

export async function getInvoiceByPaypalId(db: Database, paypalInvoiceId: string): Promise<InvoiceWithMerchant | null> {
  return first(db, `${invoiceSelect} WHERE i.paypal_invoice_id = $1 LIMIT 1`, [paypalInvoiceId]);
}

export async function getInvoiceById(db: Database, id: string): Promise<InvoiceWithMerchant | null> {
  return first(db, `${invoiceSelect} WHERE i.id = $1 LIMIT 1`, [id]);
}

export async function updateInvoiceStatus(db: Database, idOrPaypalId: string, status: string): Promise<void> {
  await db.query('UPDATE invoices SET status = $1 WHERE id = $2 OR paypal_invoice_id = $2', [status, idOrPaypalId]);
}

export async function getMerchantById(db: Database, id: string): Promise<Merchant | null> {
  return first(db, 'SELECT * FROM merchants WHERE id = $1', [id]);
}
