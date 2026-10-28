import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/connection.js';
import {
  addLedgerEntry,
  getBalance,
  getUserById,
  listContacts,
  recordTransaction,
  writeAudit,
} from '../src/db/repository.js';
import { runMigrations } from '../src/db/schema.js';
import { seedDemoData } from '../src/db/seed.js';

describe('Database Layer & Repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Fresh isolated in-memory database for each test case
    db = createDb(':memory:');
    runMigrations(db);
  });

  it('runs migrations and creates all required tables', () => {
    const tables = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
      )
      .all()
      .map((row) => row.name);

    const requiredTables = [
      'approvals',
      'audit_events',
      'blocklist',
      'contacts',
      'guardians',
      'invoices',
      'merchants',
      'notifications',
      'transactions',
      'users',
      'wallet_ledger',
    ];

    for (const table of requiredTables) {
      expect(tables).toContain(table);
    }
  });

  it('seeds demo data and reads back Meena, Ramesh, contacts, merchant, and starting balance', () => {
    const result = seedDemoData(db);

    expect(result.userId).toBe('user_meena');
    expect(result.guardianId).toBe('guardian_ramesh');
    expect(result.merchantId).toBe('merchant_ravi_cabs');
    expect(result.balance).toBe(0);

    // Verify user record
    const user = getUserById(db, 'user_meena');
    expect(user).not.toBeNull();
    expect(user?.name).toBe('Meena');
    expect(user?.language).toBe('hi');
    const limits = JSON.parse(user!.limits);
    expect(limits.daily_total).toBe(1000);

    // Verify guardian record
    const guardian = db
      .prepare<[string], { name: string; contact: string }>(
        'SELECT name, contact FROM guardians WHERE id = ?'
      )
      .get(result.guardianId);
    expect(guardian?.name).toBe('Ramesh');

    // Verify contacts
    const contacts = listContacts(db, 'user_meena');
    expect(contacts.length).toBe(2);
    const aliases = contacts.map((c) => c.alias);
    expect(aliases).toContain('bhaiya');
    expect(aliases).toContain('sabzi_wala');
    expect(contacts.every((c) => c.status === 'active')).toBe(true);

    // Verify merchant
    const merchant = db
      .prepare<[string], { name: string; verified: number }>(
        'SELECT name, verified FROM merchants WHERE id = ?'
      )
      .get(result.merchantId);
    expect(merchant?.name).toBe('Ravi Cabs');
    expect(merchant?.verified).toBe(1);

    // Verify starting balance
    expect(getBalance(db, 'user_meena')).toBe(0);
  });

  it('returns null for non-existent user', () => {
    expect(getUserById(db, 'non_existent_id')).toBeNull();
  });

  it('accurately tracks wallet balance through ledger entries', () => {
    seedDemoData(db);
    expect(getBalance(db, 'user_meena')).toBe(0);

    // Credit ₹500 (e.g. family funds wallet)
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: 500,
      reason: 'Ramesh funded wallet via PayPal',
      ref: 'paypal_order_123',
    });
    expect(getBalance(db, 'user_meena')).toBe(500);

    // Debit ₹250 (e.g. paid cab)
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: -250,
      reason: 'Paid Ravi Cabs',
      ref: 'paypal_payout_456',
    });
    expect(getBalance(db, 'user_meena')).toBe(250);

    // Debit another ₹200
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: -200,
      reason: 'Paid Bhaiya',
      ref: 'paypal_payout_789',
    });
    expect(getBalance(db, 'user_meena')).toBe(50);
  });

  it('records a transaction with risk scoring and decision', () => {
    seedDemoData(db);

    const tx = recordTransaction(db, {
      user_id: 'user_meena',
      type: 'send_money',
      amount: 250,
      currency: 'INR',
      counterparty_type: 'merchant',
      counterparty_id: 'merchant_ravi_cabs',
      tier: 2,
      risk_score: 0.15,
      decision: 'approved',
      status: 'completed',
      paypal_ref: 'PAYID-ABC123XYZ',
    });

    expect(tx.id).toBeDefined();
    expect(tx.amount).toBe(250);

    // Query back from DB
    const stored = db
      .prepare<[string], { amount: number; decision: string; paypal_ref: string }>(
        'SELECT amount, decision, paypal_ref FROM transactions WHERE id = ?'
      )
      .get(tx.id);

    expect(stored?.amount).toBe(250);
    expect(stored?.decision).toBe('approved');
    expect(stored?.paypal_ref).toBe('PAYID-ABC123XYZ');
  });

  it('writes and preserves structured audit log events', () => {
    seedDemoData(db);

    const audit = writeAudit(db, {
      user_id: 'user_meena',
      kind: 'voice_intent_parsed',
      payload: JSON.stringify({
        intent: 'send_money',
        recipient: 'bhaiya',
        amount: 200,
        raw_speech: 'bhaiya ko 200 rupaye bhej do',
      }),
    });

    expect(audit.id).toBeDefined();

    const stored = db
      .prepare<[string], { kind: string; payload: string }>(
        'SELECT kind, payload FROM audit_events WHERE id = ?'
      )
      .get(audit.id);

    expect(stored?.kind).toBe('voice_intent_parsed');
    const parsedPayload = JSON.parse(stored!.payload);
    expect(parsedPayload.recipient).toBe('bhaiya');
  });
});
