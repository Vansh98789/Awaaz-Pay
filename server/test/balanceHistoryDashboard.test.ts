import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';

vi.mock('../src/paypal/index.js', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  clearTokenCache: vi.fn(),
  createPayoutBatch: vi.fn().mockResolvedValue({
    batch_header: { payout_batch_id: 'batch_mock', batch_status: 'SUCCESS' },
  }),
  getPayoutBatch: vi.fn().mockResolvedValue({
    batch_header: { payout_batch_id: 'batch_mock', batch_status: 'SUCCESS' },
  }),
  createOrder: vi.fn(),
  captureOrder: vi.fn(),
  createInvoice: vi.fn(),
  getInvoice: vi.fn(),
  sendInvoice: vi.fn(),
  generateInvoiceQrCode: vi.fn(),
  recordInvoicePayment: vi.fn(),
  PayPalError: class extends Error {},
}));

import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import {
  addLedgerEntry,
  getBalance,
  recordTransaction,
  createApproval,
} from '../src/db/repository.js';
import {
  getSevenDaySummary,
  explainRecentPayment,
  getLastSenderAmount,
} from '../src/conversation/historyHelper.js';
import { processConversation } from '../src/conversation/orchestrator.js';
import { clearAllSessions } from '../src/conversation/session.js';

describe('Task 17: Balance, History, Explanations and Family Dashboard', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.DEMO_AUTH_BYPASS = 'true';
    clearAllSessions();
    db = createDb(':memory:');
    seedDemoData(db);

    // Initial ledger funding
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: 2300,
      reason: 'Family funding (Ramesh)',
      ref: 'paypal_capture_initial_1',
    });

    // Create 2 completed transactions in the past 7 days
    recordTransaction(db, {
      user_id: 'user_meena',
      type: 'send_money',
      amount: 250,
      currency: 'INR',
      counterparty_type: 'contact',
      counterparty_id: 'contact_sabzi_wala',
      tier: 1,
      risk_score: 0.1,
      decision: 'allow_with_confirmation',
      status: 'completed',
      paypal_ref: 'batch_1',
    });

    recordTransaction(db, {
      user_id: 'user_meena',
      type: 'send_money',
      amount: 500,
      currency: 'INR',
      counterparty_type: 'contact',
      counterparty_id: 'contact_bhaiya',
      tier: 1,
      risk_score: 0.1,
      decision: 'allow_with_confirmation',
      status: 'completed',
      paypal_ref: 'batch_2',
    });

    // Deduct payments from ledger
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: -250,
      reason: 'Payment to Sabzi wala',
      ref: 'res_1',
    });
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: -500,
      reason: 'Payment to Bhaiya',
      ref: 'res_2',
    });

    // Add 1 blocked scam payment (flagged)
    recordTransaction(db, {
      user_id: 'user_meena',
      type: 'send_money',
      amount: 4000,
      currency: 'INR',
      counterparty_type: 'new_personal',
      counterparty_id: 'scammer@fake.com',
      tier: 3,
      risk_score: 0.95,
      decision: 'block',
      status: 'failed',
      paypal_ref: null,
    });

    app = createApp(db);
  });

  describe('1. check_balance', () => {
    it('answers exact balance from the wallet ledger', async () => {
      const balance = getBalance(db, 'user_meena');
      expect(balance).toBe(1550); // 2300 - 250 - 500

      const res = await processConversation(db, 'sess-bal-1', 'Mere paas kitna paisa hai?', 'user_meena');
      expect(res.replyText).toContain('1,550');
      expect(res.replyText).toContain('rupaye');
    });
  });

  describe('2. read_history (7-day summary)', () => {
    it('builds facts in code and numbers match the ledger exactly', () => {
      const summary = getSevenDaySummary(db, 'user_meena');
      expect(summary.paymentCount).toBe(2);
      expect(summary.moneyIn).toBe(2300);
      expect(summary.moneyOut).toBe(750); // 250 + 500
      expect(summary.largestPayment).toBe(500);

      expect(summary.spokenText.hi).toContain('2 payment');
      expect(summary.spokenText.hi).toContain('750');
      expect(summary.spokenText.hi).toContain('2,300');
      expect(summary.spokenText.hi).toContain('500');

      expect(summary.spokenText.en).toContain('2 payments');
      expect(summary.spokenText.en).toContain('750');
    });

    it('answers conversational history question: "is hafte kya hua"', async () => {
      const res = await processConversation(db, 'sess-hist-1', 'Is hafte kya hua?', 'user_meena');
      expect(res.replyText).toContain('2 payment');
      expect(res.replyText).toContain('750');
      expect(res.replyText).toContain('2,300');
      expect(res.replyText).toContain('500');
    });

    it('answers in English for "what happened this week"', async () => {
      db.prepare("UPDATE users SET language = 'en' WHERE id = 'user_meena'").run();
      const res = await processConversation(db, 'sess-hist-en', 'what happened this week?', 'user_meena');
      expect(res.replyLanguage).toBe('en');
      expect(res.replyText).toContain('2 payments');
      expect(res.replyText).toContain('750');
    });
  });

  describe('3. Conversational Follow-ups and Navigation Commands', () => {
    it('answers follow-up: "Ramesh ne last time kitna bheja?" from ledger context', async () => {
      const res = await processConversation(db, 'sess-follow-1', 'Ramesh ne last time kitna bheja?', 'user_meena');
      expect(res.replyText).toContain('Ramesh ne aakhri baar');
      expect(res.replyText).toContain('2,300');
    });

    it('handles navigation commands: dohrao, agla, and ruko', async () => {
      const sessId = 'sess-nav-1';
      // Step 1: Read history
      const hTurn = await processConversation(db, sessId, 'Is hafte kya hua?', 'user_meena');
      expect(hTurn.replyText).toContain('Is hafte aapne 2 payment kiye');

      // Step 2: dohrao (repeat)
      const repeatTurn = await processConversation(db, sessId, 'dohrao', 'user_meena');
      expect(repeatTurn.replyText).toBe(hTurn.replyText);

      // Step 3: agla (next transaction detail)
      const nextTurn = await processConversation(db, sessId, 'agla', 'user_meena');
      expect(nextTurn.replyText).toContain('Agla transaction');
      expect(nextTurn.replyText).toContain('500');

      // Step 4: ruko (stop)
      const stopTurn = await processConversation(db, sessId, 'ruko', 'user_meena');
      expect(stopTurn.replyText).toContain('Theek hai, main ruk gayi');
    });
  });

  describe('4. explain_payment', () => {
    it('explains the most recent payment in plain words using stored facts only', () => {
      const explanation = explainRecentPayment(db, 'user_meena');
      expect(explanation.found).toBe(true);
      expect(explanation.payee).toBe('Bhaiya');
      expect(explanation.amount).toBe(500);
      expect(explanation.fee).toBe(0);
      expect(explanation.reversible).toBe(false);

      expect(explanation.spokenText.hi).toContain('Bhaiya');
      expect(explanation.spokenText.hi).toContain('500');
      expect(explanation.spokenText.hi).toContain('koi fee nahi lagi');
      expect(explanation.spokenText.hi).toContain('wapas nahi ho sakta');
    });

    it('answers conversational request: "pichla payment explain karo"', async () => {
      const res = await processConversation(db, 'sess-exp-1', 'explain pichla payment', 'user_meena');
      expect(res.replyText).toContain('Bhaiya');
      expect(res.replyText).toContain('500');
      expect(res.replyText).toContain('wapas nahi ho sakta');
    });
  });

  describe('5. Family Dashboard API (/api/family/dashboard)', () => {
    it('returns balance, limits, pending approvals, and transactions for AG Grid', async () => {
      // Add a pending approval
      const tx = recordTransaction(db, {
        user_id: 'user_meena',
        type: 'send_money',
        amount: 800,
        currency: 'INR',
        counterparty_type: 'merchant',
        counterparty_id: 'merchant_ravi_cabs',
        tier: 3,
        risk_score: 0.6,
        decision: 'need_guardian_approval',
        status: 'pending',
        paypal_ref: null,
      });

      createApproval(db, {
        transaction_id: tx.id,
        guardian_id: 'guardian_ramesh',
        token: 'token_dashboard_test_1',
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });

      const res = await request(app).get('/api/family/dashboard?userId=user_meena');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.userName).toBe('Meena');
      expect(res.body.balance).toBe(1550);
      expect(res.body.limits.daily_total).toBe(1000);

      // Verify pending approvals
      expect(res.body.pendingApprovals).toHaveLength(1);
      expect(res.body.pendingApprovals[0].amount).toBe(800);
      expect(res.body.pendingApprovals[0].payee).toBe('Ravi Cabs');

      // Verify transactions data format for AG Grid
      const rows = res.body.transactions;
      expect(rows.length).toBeGreaterThan(0);

      // Verify flagged row for blocked scam
      const blockedRow = rows.find((r: any) => r.amount === 4000);
      expect(blockedRow).toBeDefined();
      expect(blockedRow.decision).toBe('block');
      expect(blockedRow.isFlagged).toBe(true);
      expect(blockedRow.risk).toBe('High');
    });
  });
});
