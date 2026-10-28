import type Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './connection.js';
import {
  addLedgerEntry,
  getBalance,
  upsertContact,
  upsertGuardian,
  upsertMerchant,
  upsertUser,
} from './repository.js';
import { runMigrations } from './schema.js';

export interface SeedResult {
  userId: string;
  guardianId: string;
  contactIds: string[];
  merchantId: string;
  balance: number;
}

// Seed predictable demo personas required for video and hackathon evaluation
export function seedDemoData(db: Database.Database): SeedResult {
  runMigrations(db);

  const now = new Date().toISOString();

  // 1. Primary Persona: Meena (Hindi speaking, visually impaired / low literacy)
  const user = upsertUser(db, {
    id: 'user_meena',
    name: 'Meena',
    language: 'hi',
    limits: JSON.stringify({
      daily_total: 1000,
      per_transaction_new_payee: 500,
      max_new_payees_per_day: 2,
    }),
    created_at: now,
  });

  // 2. Guardian: Ramesh (her son abroad who approves high-risk transactions)
  const guardian = upsertGuardian(db, {
    id: 'guardian_ramesh',
    user_id: user.id,
    name: 'Ramesh',
    contact: '+971501234567',
    permissions: 'all',
  });

  // 3. Trusted contacts: Bhaiya and Sabzi wala (active, past cooling-off)
  const contact1 = upsertContact(db, {
    id: 'contact_bhaiya',
    user_id: user.id,
    alias: 'bhaiya',
    display_name: 'Bhaiya',
    paypal_email: 'bhaiya-sandbox@example.com',
    status: 'active',
    added_by: guardian.id,
    activated_at: now,
  });

  const contact2 = upsertContact(db, {
    id: 'contact_sabzi_wala',
    user_id: user.id,
    alias: 'sabzi_wala',
    display_name: 'Sabzi wala',
    paypal_email: 'sabzi-sandbox@example.com',
    status: 'active',
    added_by: user.id,
    activated_at: now,
  });

  // 4. Merchant: Ravi Cabs (for QR code payments)
  const merchant = upsertMerchant(db, {
    id: 'merchant_ravi_cabs',
    name: 'Ravi Cabs',
    paypal_email: 'ravi-cabs-sandbox@example.com',
    verified: 1,
  });

  // 5. Explicit opening balance record of 0
  const currentBalance = getBalance(db, user.id);
  if (currentBalance === 0) {
    const existingInit = db
      .prepare<[string, string]>('SELECT id FROM wallet_ledger WHERE user_id = ? AND ref = ?')
      .get(user.id, 'seed_opening_balance');

    if (!existingInit) {
      addLedgerEntry(db, {
        user_id: user.id,
        delta: 0,
        reason: 'Opening balance',
        ref: 'seed_opening_balance',
        created_at: now,
      });
    }
  }

  return {
    userId: user.id,
    guardianId: guardian.id,
    contactIds: [contact1.id, contact2.id],
    merchantId: merchant.id,
    balance: getBalance(db, user.id),
  };
}

// Allow direct execution via npm run seed
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const db = getDb();
    const result = seedDemoData(db);
    console.log('[Seed] Database seeded successfully:');
    console.log(`  - User: ${result.userId} (Meena)`);
    console.log(`  - Guardian: ${result.guardianId} (Ramesh)`);
    console.log(`  - Contacts: ${result.contactIds.join(', ')}`);
    console.log(`  - Merchant: ${result.merchantId} (Ravi Cabs)`);
    console.log(`  - Starting Balance: ₹${result.balance}`);
    process.exit(0);
  } catch (err) {
    console.error('[Seed] Failed to seed database:', err);
    process.exit(1);
  }
}
