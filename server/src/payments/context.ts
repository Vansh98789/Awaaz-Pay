import type Database from 'better-sqlite3';
import type {
  PaymentContext,
  PaymentRequest,
  PayeeType,
  ScamRiskLevel,
  UserPaymentLimits,
} from '../rules/types.js';
import type { Contact, Merchant, User } from '../db/types.js';

export interface ResolvedPayee {
  payeeType: PayeeType;
  counterpartyType: 'contact' | 'merchant' | 'new_personal';
  counterpartyId: string;
  displayName: string;
  email: string;
  contact?: Contact;
  merchant?: Merchant;
}

export function resolvePayee(
  db: Database.Database,
  userId: string,
  payeeQuery: string
): ResolvedPayee {
  const q = payeeQuery.trim().toLowerCase();

  const contact = db
    .prepare<[string, string, string, string], Contact>(
      `SELECT * FROM contacts 
       WHERE user_id = ? AND (LOWER(alias) = ? OR LOWER(display_name) = ? OR LOWER(paypal_email) = ?) 
       LIMIT 1`
    )
    .get(userId, q, q, q);

  if (contact) {
    return {
      payeeType: 'trusted_contact',
      counterpartyType: 'contact',
      counterpartyId: contact.id,
      displayName: contact.display_name,
      email: contact.paypal_email,
      contact,
    };
  }

  const merchant = db
    .prepare<[string, string], Merchant>(
      `SELECT * FROM merchants 
       WHERE LOWER(name) = ? OR LOWER(paypal_email) = ? 
       LIMIT 1`
    )
    .get(q, q);

  if (merchant) {
    return {
      payeeType: merchant.verified ? 'new_merchant_verified' : 'new_personal',
      counterpartyType: 'merchant',
      counterpartyId: merchant.id,
      displayName: merchant.name,
      email: merchant.paypal_email,
      merchant,
    };
  }

  return {
    payeeType: 'new_personal',
    counterpartyType: 'new_personal',
    counterpartyId: payeeQuery,
    displayName: payeeQuery,
    email: payeeQuery.includes('@') ? payeeQuery : `${payeeQuery.replace(/\s+/g, '')}@sandbox.paypal.com`,
  };
}

function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildPaymentContext(
  db: Database.Database,
  user: User,
  payee: ResolvedPayee,
  scamRisk: ScamRiskLevel = 'low'
): { context: PaymentContext; isBlocklisted: boolean } {
  let limits: UserPaymentLimits = {};
  try {
    limits = JSON.parse(user.limits);
  } catch {
    limits = {};
  }

  const blocklisted = db
    .prepare<[string], { count: number }>(
      'SELECT COUNT(*) AS count FROM blocklist WHERE LOWER(paypal_email) = ?'
    )
    .get(payee.email.toLowerCase())?.count ?? 0;
  const isBlocklisted = blocklisted > 0;

  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const todayTxList = db
    .prepare<[string, string], { amount: number; currency: string; counterparty_id: string; counterparty_type: string; created_at: string }>(
      `SELECT amount, currency, counterparty_id, counterparty_type, created_at
       FROM transactions 
       WHERE user_id = ? AND status IN ('completed', 'processing', 'confirmed', 'pending_confirmation') AND created_at >= ?`
    )
    .all(user.id, startOfDay);

  const todayTotalAmount = todayTxList.reduce(
    (sum, tx) => sum + (tx.currency === 'USD' ? tx.amount : tx.amount * 0.012),
    0
  );

  const newPayeesToday = new Set<string>();
  let todayNewPayeesTotalAmount = 0;
  let cumulativeAmountToThisPayee = 0;

  for (const tx of todayTxList) {
    if (tx.counterparty_type !== 'contact') {
      newPayeesToday.add(tx.counterparty_id);
      todayNewPayeesTotalAmount += tx.currency === 'USD' ? tx.amount : tx.amount * 0.012;
    }
    if (tx.counterparty_id === payee.counterpartyId) {
      cumulativeAmountToThisPayee += tx.currency === 'USD' ? tx.amount : tx.amount * 0.012;
    }
  }

  const isNewPayeeForToday =
    payee.counterpartyType !== 'contact' && !newPayeesToday.has(payee.counterpartyId);
  const todayNewPayeesCount = newPayeesToday.size;

  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const recentPayments = db
    .prepare<[string, string], { created_at: string }>(
      `SELECT created_at FROM transactions 
       WHERE user_id = ? AND created_at >= ? 
       ORDER BY created_at DESC`
    )
    .all(user.id, tenMinutesAgo);

  const pastAmounts = db
    .prepare<[string], { amount: number; currency: string }>(
      `SELECT amount, currency FROM transactions
       WHERE user_id = ? AND status = 'completed'`
    )
    .all(user.id)
    .map((r) => r.currency === 'USD' ? r.amount : r.amount * 0.012);

  const medianPastPaymentAmount = calculateMedian(pastAmounts);

  const context: PaymentContext = {
    userLimits: limits,
    todayTotalAmount,
    todayNewPayeesTotalAmount,
    todayNewPayeesCount,
    isNewPayeeForToday,
    cumulativeAmountToThisPayee,
    contactStatus: payee.contact?.status,
    contactActivatedAt: payee.contact?.activated_at,
    recentPaymentTimestamps: recentPayments.map((p) => p.created_at),
    medianPastPaymentAmount,
    scamRisk,
    isBlocklisted,
    currentTimestamp: now.toISOString(),
  };

  return { context, isBlocklisted };
}
