import type Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from './connection.js';
import { runMigrations } from './schema.js';
import {
  upsertUser,
  upsertGuardian,
  upsertContact,
  upsertMerchant,
  addLedgerEntry,
  recordTransaction,
  createInvoiceRecord,
  getBalance,
} from './repository.js';
import { cacheKey, putInCache } from '../llm/cache.js';
import { buildSystemPrompt } from '../intent/systemPrompt.js';

import { clearAllSessions } from '../conversation/session.js';

export function resetAndSeedDemoDatabase(db: Database.Database) {
  // Ensure all tables exist first
  runMigrations(db);

  // Clear all existing data in deterministic order
  db.exec(`
    DELETE FROM approvals;
    DELETE FROM notifications;
    DELETE FROM audit_events;
    DELETE FROM wallet_ledger;
    DELETE FROM transactions;
    DELETE FROM invoices;
    DELETE FROM contacts;
    DELETE FROM guardians;
    DELETE FROM passkeys;
    DELETE FROM blocklist;
    DELETE FROM users;
  `);

  clearAllSessions();

  const now = new Date();
  const past48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const past4d = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const past2d = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // 1. User Meena
  const user = upsertUser(db, {
    id: 'user_meena',
    name: 'Meena',
    language: 'hi',
    limits: JSON.stringify({
      daily_total: 5000,
      per_transaction_new_payee: 500,
      max_new_payees_per_day: 2,
    }),
    created_at: past4d,
  });

  // 2. Guardian Ramesh
  const guardian = upsertGuardian(db, {
    id: 'guardian_ramesh',
    user_id: user.id,
    name: 'Ramesh',
    contact: '+971501234567',
    permissions: 'all',
  });

  // 3. Contacts
  const bhaiya = upsertContact(db, {
    id: 'contact_bhaiya',
    user_id: user.id,
    alias: 'bhaiya',
    display_name: 'Bhaiya',
    paypal_email: 'bhaiya-sandbox@example.com',
    status: 'active',
    added_by: guardian.id,
    activated_at: past48h,
  });

  const sabziWala = upsertContact(db, {
    id: 'contact_sabzi_wala',
    user_id: user.id,
    alias: 'sabzi_wala',
    display_name: 'Sabzi wala',
    paypal_email: 'sabzi-sandbox@example.com',
    status: 'active',
    added_by: user.id,
    activated_at: past48h,
  });

  upsertContact(db, {
    id: 'contact_doodh_wala',
    user_id: user.id,
    alias: 'doodh_wala',
    display_name: 'Milk vendor',
    paypal_email: 'milk-vendor-sandbox@example.com',
    status: 'active',
    added_by: user.id,
    activated_at: past48h,
  });

  // 4. Demo Merchant Ravi Cabs
  const merchant = upsertMerchant(db, {
    id: 'merchant_ravi_cabs',
    name: 'Ravi Cabs',
    paypal_email: 'ravi-cabs-sandbox@example.com',
    verified: 1,
  });

  // Pre-seed demo invoice for QR scanning
  createInvoiceRecord(db, {
    id: 'inv_demo_ravi_250',
    merchant_id: merchant.id,
    amount: 250,
    currency: 'USD',
    status: 'SENT',
    paypal_invoice_id: 'INV2-DEMO-RAVI-250',
  });

  // 5. Wallet Ledger & History
  // Initial deposit 4 days ago
  addLedgerEntry(db, {
    user_id: user.id,
    delta: 2500,
    reason: 'Ramesh funding',
    ref: 'ledger_initial_funding',
    created_at: past4d,
  });

  // Sabzi wala payment 2 days ago
  recordTransaction(db, {
    user_id: user.id,
    type: 'send',
    amount: 2.40,
    currency: 'USD',
    counterparty_type: 'contact',
    counterparty_id: sabziWala.id,
    tier: 1,
    risk_score: 0.1,
    decision: 'allow',
    status: 'completed',
    created_at: past2d,
  });
  addLedgerEntry(db, {
    user_id: user.id,
    delta: -200,
    reason: 'Payment to Sabzi wala',
    ref: 'tx_sabzi_200',
    created_at: past2d,
  });

  const finalBalance = getBalance(db, user.id);

  // 6. Pre-seed LLM Demo Cache for 100% offline & instantaneous demo experience
  seedLlmCache();

  return {
    userId: user.id,
    guardianId: guardian.id,
    contacts: [bhaiya.alias, sabziWala.alias],
    merchant: merchant.name,
    balance: finalBalance,
  };
}

function seedLlmCache() {
  const idlePrompt = buildSystemPrompt(['bhaiya', 'sabzi_wala'], 'idle');
  const confirmPrompt = buildSystemPrompt(['bhaiya', 'sabzi_wala'], 'awaiting_confirmation');

  // Seed Intent prompts for idle state
  const idlePhrases: Array<{ phrase: string; result: Record<string, unknown> }> = [
    {
      phrase: 'Mera balance kitna hai',
      result: {
        intent: 'check_balance',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 0.99,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Balance check karo',
      result: {
        intent: 'check_balance',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 0.99,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Bhaiya ko 3 dollars bhejo',
      result: {
        intent: 'send_money',
        recipient_alias: 'bhaiya',
        amount: 3,
        language: 'hi',
        confidence: 0.98,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Send 3 dollars to Bhaiya',
      result: {
        intent: 'send_money',
        recipient_alias: 'bhaiya',
        amount: 3,
        language: 'hi',
        confidence: 0.98,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Pichle 7 dino ka hisab batao',
      result: {
        intent: 'read_history',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 0.99,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'What happened this week',
      result: {
        intent: 'read_history',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 0.99,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Aakhri payment samjhao',
      result: {
        intent: 'explain_payment',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 0.99,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Explain the last payment',
      result: {
        intent: 'explain_payment',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 0.99,
        scam_cues: [],
        clarifying_question: null,
      },
    },
  ];

  for (const { phrase, result } of idlePhrases) {
    const key = cacheKey(idlePrompt, phrase);
    putInCache(key, result);
  }

  // Seed confirmation state
  const confirmPhrases: Array<{ phrase: string; result: Record<string, unknown> }> = [
    {
      phrase: 'Haan',
      result: {
        intent: 'confirm_yes',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 1.0,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Haan bhej do',
      result: {
        intent: 'confirm_yes',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 1.0,
        scam_cues: [],
        clarifying_question: null,
      },
    },
    {
      phrase: 'Yes confirm',
      result: {
        intent: 'confirm_yes',
        recipient_alias: null,
        amount: null,
        language: 'hi',
        confidence: 1.0,
        scam_cues: [],
        clarifying_question: null,
      },
    },
  ];

  for (const { phrase, result } of confirmPhrases) {
    const key = cacheKey(confirmPrompt, phrase);
    putInCache(key, result);
  }

  // Seed scam phrase in idle prompt
  const scamPhrases: Array<{ phrase: string; result: Record<string, unknown> }> = [
    {
      phrase: 'Bijli vibhag se bol raha hoon, 5 dollars turant transfer karo nahi to bijli kat jayegi',
      result: {
        intent: 'send_money',
        recipient_alias: null,
        amount: 5,
        language: 'hi',
        confidence: 0.95,
        scam_cues: ['urgency', 'threat_authority', 'pressure_to_pay_now'],
        clarifying_question: 'Kya kisi ne phone par aapko yeh payment karne ke liye kaha hai?',
      },
    },
    {
      phrase: 'Electricity department urgently pay 5 dollars otherwise power cut',
      result: {
        intent: 'send_money',
        recipient_alias: null,
        amount: 5,
        language: 'hi',
        confidence: 0.95,
        scam_cues: ['urgency', 'threat_authority'],
        clarifying_question: 'Did someone call you asking for this payment?',
      },
    },
  ];

  for (const { phrase, result } of scamPhrases) {
    const key = cacheKey(idlePrompt, phrase);
    putInCache(key, result);
  }
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const db = getDb();
    const result = resetAndSeedDemoDatabase(db);
    console.log('[Demo Reset] Database reset & demo state seeded successfully:');
    console.log(`  - User: ${result.userId} (Meena)`);
    console.log(`  - Guardian: ${result.guardianId} (Ramesh)`);
    console.log(`  - Contacts: ${result.contacts.join(', ')}`);
    console.log(`  - Demo Merchant: ${result.merchant} (Invoice: INV2-DEMO-RAVI-250)`);
    console.log(`  - LLM Demo Cache: Seeded in llm_demo_cache.json`);
    process.exit(0);
  } catch (err) {
    console.error('[Demo Reset] Error resetting demo database:', err);
    process.exit(1);
  }
}
