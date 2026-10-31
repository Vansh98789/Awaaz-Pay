import type { AppDatabase as Database } from './connection.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './connection.js';
import {
  addLedgerEntry,
  getBalance,
  hasLedgerRef,
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

export async function seedDemoData(db: Database): Promise<SeedResult> {
  await runMigrations(db);

  const now = new Date().toISOString();
  const pastActiveDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const user = await upsertUser(db, {
    id: 'user_meena',
    name: 'Meena',
    language: 'hi',
    limits: JSON.stringify({
      daily_total: 5000,
      per_transaction_new_payee: 500,
      max_new_payees_per_day: 2,
    }),
    created_at: now,
  });

  const guardian = await upsertGuardian(db, {
    id: 'guardian_ramesh',
    user_id: user.id,
    name: 'Ramesh',
    contact: '+971501234567',
    permissions: 'all',
  });

  const contact1 = await upsertContact(db, {
    id: 'contact_bhaiya',
    user_id: user.id,
    alias: 'bhaiya',
    display_name: 'Bhaiya',
    paypal_email: 'bhaiya-sandbox@example.com',
    status: 'active',
    added_by: guardian.id,
    activated_at: pastActiveDate,
  });

  const contact2 = await upsertContact(db, {
    id: 'contact_sabzi_wala',
    user_id: user.id,
    alias: 'sabzi_wala',
    display_name: 'Sabzi wala',
    paypal_email: 'sabzi-sandbox@example.com',
    status: 'active',
    added_by: user.id,
    activated_at: pastActiveDate,
  });

  await upsertContact(db, {
    id: 'contact_doodh_wala',
    user_id: user.id,
    alias: 'doodh_wala',
    display_name: 'Milk vendor',
    paypal_email: 'milk-vendor-sandbox@example.com',
    status: 'active',
    added_by: user.id,
    activated_at: pastActiveDate,
  });

  const merchant = await upsertMerchant(db, {
    id: 'merchant_ravi_cabs',
    name: 'Ravi Cabs',
    paypal_email: 'ravi-cabs-sandbox@example.com',
    verified: 1,
  });

  const existingInit = await hasLedgerRef(db, 'seed_opening_balance');
  if (!existingInit) {
    await addLedgerEntry(db, {
        user_id: user.id,
        delta: 0,
        reason: 'Opening balance',
        ref: 'seed_opening_balance',
        created_at: now,
      });
  }

  return {
    userId: user.id,
    guardianId: guardian.id,
    contactIds: [contact1.id, contact2.id],
    merchantId: merchant.id,
    balance: await getBalance(db, user.id),
  };
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const db = getDb();
    const result = await seedDemoData(db);
    console.log('[Seed] Database seeded:');
    console.log(`  - User: ${result.userId} (Meena)`);
    console.log(`  - Guardian: ${result.guardianId} (Ramesh)`);
    console.log(`  - Contacts: ${result.contactIds.join(', ')}`);
    console.log(`  - Merchant: ${result.merchantId} (Ravi Cabs)`);
    process.exit(0);
  } catch (err) {
    console.error('[Seed] Failed to seed database:', err);
    process.exit(1);
  }
}
