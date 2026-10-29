import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import { addLedgerEntry, getBalance, getTransactionById } from '../src/db/repository.js';

vi.mock('../src/paypal/index.js', () => ({
  createOrder: vi.fn(),
  captureOrder: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  getAccessToken: vi.fn(),
  clearTokenCache: vi.fn(),
  createPayoutBatch: vi.fn(),
  getPayoutBatch: vi.fn(),
  createInvoice: vi.fn(),
  getInvoice: vi.fn(),
  sendInvoice: vi.fn(),
  generateInvoiceQrCode: vi.fn(),
  recordInvoicePayment: vi.fn(),
  PayPalError: class extends Error {},
}));

import { createPayoutBatch, getPayoutBatch } from '../src/paypal/index.js';

const mockCreatePayout = vi.mocked(createPayoutBatch);
const mockGetPayout = vi.mocked(getPayoutBatch);

describe('Payment Pipeline (Task 10)', () => {
  let db: Database.Database;
  let testApp: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.DEMO_AUTH_BYPASS = 'true';
    vi.clearAllMocks();
    db = createDb(':memory:');
    seedDemoData(db);
    testApp = createApp(db);

    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: 2000,
      reason: 'Wallet pre-fund for testing',
      ref: 'test_fund_init',
    });
  });

  describe('POST /api/payments/prepare', () => {
    it('prepares allowed payment for trusted contact within Tier 1 limits', async () => {
      const res = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 500 });

      expect(res.status).toBe(200);
      expect(res.body.decision.action).toBe('allow_with_confirmation');
      expect(res.body.decision.tier).toBe(1);
      expect(res.body.status).toBe('pending_confirmation');
      expect(res.body.transactionId).toBeDefined();
      expect(res.body.readbackText).toContain('Bhaiya');
      expect(res.body.readbackText).toContain('500');

      const tx = getTransactionById(db, res.body.transactionId);
      expect(tx).not.toBeNull();
      expect(tx?.status).toBe('pending_confirmation');
      expect(tx?.counterparty_type).toBe('contact');
    });

    it('requires guardian approval when trusted contact payment exceeds Tier 1 limit', async () => {
      const res = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 6000 });

      expect(res.status).toBe(200);
      expect(res.body.decision.action).toBe('need_guardian_approval');
      expect(res.body.decision.tier).toBe(3);
      expect(res.body.status).toBe('awaiting_approval');
    });

    it('blocks payment when payee is on blocklist', async () => {
      db.prepare('INSERT INTO blocklist (id, paypal_email, reason) VALUES (?, ?, ?)').run(
        'blk-1',
        'scammer@fraud.com',
        'Reported phishing scam'
      );

      const res = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'scammer@fraud.com', amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.decision.action).toBe('block');
      expect(res.body.status).toBe('failed');
    });

    it('blocks payment on high scam risk', async () => {
      const res = await request(testApp)
        .post('/api/payments/prepare')
        .send({
          userId: 'user_meena',
          payee: 'bhaiya',
          amount: 500,
          scamRisk: 'high',
        });

      expect(res.status).toBe(200);
      expect(res.body.decision.action).toBe('block');
      expect(res.body.status).toBe('failed');
    });
  });

  describe('POST /api/payments/confirm', () => {
    it('happy path: confirms payment, reserves funds, calls PayPal payout, marks completed', async () => {
      mockCreatePayout.mockResolvedValueOnce({
        batch_header: {
          payout_batch_id: 'PAYOUT-BATCH-777',
          batch_status: 'SUCCESS',
        },
      });

      const prepRes = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 500 });

      const txId = prepRes.body.transactionId;

      const confirmRes = await request(testApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: true });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.status).toBe('completed');
      expect(confirmRes.body.batchId).toBe('PAYOUT-BATCH-777');
      expect(confirmRes.body.newBalance).toBe(1500);

      expect(mockCreatePayout).toHaveBeenCalledTimes(1);
      expect(mockCreatePayout).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            recipient_email: 'bhaiya-sandbox@example.com',
            amount: 500,
          }),
        ])
      );

      const tx = getTransactionById(db, txId);
      expect(tx?.status).toBe('completed');
      expect(tx?.paypal_ref).toBe('PAYOUT-BATCH-777');
      expect(getBalance(db, 'user_meena')).toBe(1500);
    });

    it('does not allow confirming a blocked or awaiting_approval payment', async () => {
      const prepRes = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 6000 });

      const txId = prepRes.body.transactionId;
      expect(prepRes.body.status).toBe('awaiting_approval');

      const confirmRes = await request(testApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: true });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.error).toContain('Cannot confirm transaction');
      expect(mockCreatePayout).not.toHaveBeenCalled();
    });

    it('enforces idempotency: confirming twice does not pay twice', async () => {
      mockCreatePayout.mockResolvedValueOnce({
        batch_header: {
          payout_batch_id: 'BATCH-ONCE',
          batch_status: 'SUCCESS',
        },
      });

      const prepRes = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 300 });

      const txId = prepRes.body.transactionId;

      const firstConfirm = await request(testApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: true });

      expect(firstConfirm.status).toBe(200);
      expect(firstConfirm.body.status).toBe('completed');
      expect(getBalance(db, 'user_meena')).toBe(1700);

      const secondConfirm = await request(testApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: true });

      expect(secondConfirm.status).toBe(200);
      expect(secondConfirm.body.alreadyPaid).toBe(true);

      expect(mockCreatePayout).toHaveBeenCalledTimes(1);
      expect(getBalance(db, 'user_meena')).toBe(1700);
    });

    it('fails cleanly on insufficient balance with spoken message', async () => {
      const emptyDb = createDb(':memory:');
      seedDemoData(emptyDb);
      const emptyApp = createApp(emptyDb);

      const prepRes = await request(emptyApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 500 });

      const txId = prepRes.body.transactionId;

      const confirmRes = await request(emptyApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: true });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.error).toContain('Insufficient balance');
      expect(confirmRes.body.spoken_message).toBeDefined();

      const tx = getTransactionById(emptyDb, txId);
      expect(tx?.status).toBe('failed');
      expect(mockCreatePayout).not.toHaveBeenCalled();
    });

    it('reverses reservation when PayPal payout fails', async () => {
      mockCreatePayout.mockRejectedValueOnce(new Error('PayPal Payout Gateway Timeout'));

      const prepRes = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 400 });

      const txId = prepRes.body.transactionId;

      const confirmRes = await request(testApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: true });

      expect(confirmRes.status).toBe(500);
      expect(confirmRes.body.status).toBe('failed');
      expect(confirmRes.body.spoken_message).toContain('refunded');

      expect(getBalance(db, 'user_meena')).toBe(2000);

      const tx = getTransactionById(db, txId);
      expect(tx?.status).toBe('failed');
    });

    it('cancels payment when user does not confirm', async () => {
      const prepRes = await request(testApp)
        .post('/api/payments/prepare')
        .send({ userId: 'user_meena', payee: 'bhaiya', amount: 250 });

      const txId = prepRes.body.transactionId;

      const confirmRes = await request(testApp)
        .post('/api/payments/confirm')
        .send({ transactionId: txId, userConfirmed: false });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.status).toBe('cancelled');
      expect(getBalance(db, 'user_meena')).toBe(2000);

      const tx = getTransactionById(db, txId);
      expect(tx?.status).toBe('cancelled');
    });
  });
});
