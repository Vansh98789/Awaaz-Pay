import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';

vi.mock('../src/paypal/index.js', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  clearTokenCache: vi.fn(),
  createPayoutBatch: vi.fn().mockResolvedValue({
    batch_header: {
      payout_batch_id: 'batch_mock_123',
      batch_status: 'SUCCESS',
    },
  }),
  getPayoutBatch: vi.fn().mockResolvedValue({
    batch_header: {
      payout_batch_id: 'batch_mock_123',
      batch_status: 'SUCCESS',
    },
  }),
  createInvoice: vi.fn().mockResolvedValue({ id: 'INV2-MOCK-CREATED-1' }),
  getInvoice: vi.fn(),
  sendInvoice: vi.fn().mockResolvedValue(undefined),
  generateInvoiceQrCode: vi.fn().mockResolvedValue('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  recordInvoicePayment: vi.fn().mockResolvedValue(undefined),
  PayPalError: class extends Error {},
}));

vi.mock('../src/paypal/invoices.js', () => ({
  createInvoice: vi.fn().mockResolvedValue({ id: 'INV2-MOCK-CREATED-1' }),
  sendInvoice: vi.fn().mockResolvedValue(undefined),
  generateInvoiceQrCode: vi.fn().mockResolvedValue('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  recordInvoicePayment: vi.fn().mockResolvedValue(undefined),
  getInvoice: vi.fn(),
}));

import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import { parseInvoiceQr } from '../src/payments/qrParser.js';
import {
  createInvoiceRecord,
  getInvoiceByPaypalId,
  updateInvoiceStatus,
  getBalance,
  addLedgerEntry,
} from '../src/db/repository.js';
import { processConversation } from '../src/conversation/orchestrator.js';
import { clearAllSessions } from '../src/conversation/session.js';

describe('Task 16: Invoice QR Payments', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.DEMO_AUTH_BYPASS = 'true';
    clearAllSessions();
    db = createDb(':memory:');
    seedDemoData(db);
    // Fund Meena's wallet with ₹2,000 for tests
    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: 2000,
      reason: 'Test funding',
      ref: 'test_fund_task16',
    });
    app = createApp(db);
  });

  describe('1. QR Code Parser (parseInvoiceQr)', () => {
    it('parses direct PayPal invoice IDs', () => {
      expect(parseInvoiceQr('INV2-ABCD-1234-EFGH')).toBe('INV2-ABCD-1234-EFGH');
      expect(parseInvoiceQr('INV-9876-5432-1098')).toBe('INV-9876-5432-1098');
      expect(parseInvoiceQr('inv_demo_cab_12345')).toBe('inv_demo_cab_12345');
    });

    it('parses PayPal sandbox invoice URLs with hash', () => {
      const url = 'https://www.sandbox.paypal.com/invoice/p/#INV2-5678-9012-WXYZ';
      expect(parseInvoiceQr(url)).toBe('INV2-5678-9012-WXYZ');
    });

    it('parses PayPal production invoice URLs with pathname', () => {
      const url = 'https://www.paypal.com/invoice/s/pay/INV2-1111-2222-3333';
      expect(parseInvoiceQr(url)).toBe('INV2-1111-2222-3333');
    });

    it('parses query parameters containing invoice_id', () => {
      const url = 'https://pay.example.com/checkout?invoice_id=INV2-TEST-9999&src=qr';
      expect(parseInvoiceQr(url)).toBe('INV2-TEST-9999');
    });

    it('parses JSON payloads with invoiceId or invoice_id', () => {
      expect(parseInvoiceQr(JSON.stringify({ invoiceId: 'INV2-JSON-8888' }))).toBe('INV2-JSON-8888');
      expect(parseInvoiceQr(JSON.stringify({ invoice_id: 'INV2-JSON-7777' }))).toBe('INV2-JSON-7777');
    });

    it('returns null for empty or non-invoice strings', () => {
      expect(parseInvoiceQr('')).toBeNull();
      expect(parseInvoiceQr('   ')).toBeNull();
      expect(parseInvoiceQr('not a valid qr code payload at all')).toBeNull();
    });
  });

  describe('2. Merchant Demo Invoice Creation & Registry Lookup', () => {
    it('creates an invoice for Ravi Cabs and returns scannable QR', async () => {
      const res = await request(app)
        .post('/api/merchant/invoice')
        .send({
          merchantId: 'merchant_ravi_cabs',
          amount: 250,
          currency: 'INR',
          note: 'Ride with Ravi Cabs',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.merchantName).toBe('Ravi Cabs');
      expect(res.body.amount).toBe(250);
      expect(res.body.qrCodeImage).toMatch(/^data:image\/png;base64,/);
      expect(res.body.invoiceId).toBeDefined();

      // Check database
      const inv = getInvoiceByPaypalId(db, res.body.invoiceId);
      expect(inv).not.toBeNull();
      expect(inv?.amount).toBe(250);
      expect(inv?.merchant_name).toBe('Ravi Cabs');
      expect(inv?.status).toBe('SENT');
    });

    it('looks up invoice details from the local registry', async () => {
      const invRecord = createInvoiceRecord(db, {
        merchant_id: 'merchant_ravi_cabs',
        paypal_invoice_id: 'INV2-LOOKUP-TEST-1',
        amount: 250,
        currency: 'INR',
        status: 'SENT',
      });

      const res = await request(app).get(`/api/invoices/${invRecord.paypal_invoice_id}`);
      expect(res.status).toBe(200);
      expect(res.body.merchantName).toBe('Ravi Cabs');
      expect(res.body.amount).toBe(250);
      expect(res.body.verified).toBe(true);
    });

    it('returns 404 for unknown invoices', async () => {
      const res = await request(app).get('/api/invoices/INV2-UNKNOWN-999');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('scans a QR URL, decodes invoice, and returns spoken readback', async () => {
      createInvoiceRecord(db, {
        merchant_id: 'merchant_ravi_cabs',
        paypal_invoice_id: 'INV2-SCAN-READBACK-1',
        amount: 250,
        currency: 'INR',
        status: 'SENT',
      });

      const qrPayload = 'https://www.sandbox.paypal.com/invoice/p/#INV2-SCAN-READBACK-1';
      const res = await request(app)
        .post('/api/invoices/scan')
        .send({ qrData: qrPayload, userId: 'user_meena' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.merchantName).toBe('Ravi Cabs');
      expect(res.body.amount).toBe(250);
      expect(res.body.spokenReadback).toContain('Ravi Cabs, 250 rupaye. Kya main bhej doon?');
    });
  });

  describe('3. Tier 2 Rules & Caps on QR Payments', () => {
    it('allows a ₹250 payment to verified merchant within Tier 2 cap', async () => {
      createInvoiceRecord(db, {
        merchant_id: 'merchant_ravi_cabs',
        paypal_invoice_id: 'INV2-TIER2-OK',
        amount: 250,
        currency: 'INR',
        status: 'SENT',
      });

      const res = await request(app)
        .post('/api/invoices/pay')
        .send({ invoiceId: 'INV2-TIER2-OK', userId: 'user_meena', confirm: false });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('awaiting_confirmation');
      expect(res.body.amount).toBe(250);
    });

    it('requires guardian approval when QR invoice exceeds new payee limit (₹500)', async () => {
      createInvoiceRecord(db, {
        merchant_id: 'merchant_ravi_cabs',
        paypal_invoice_id: 'INV2-TIER3-HIGH',
        amount: 750, // exceeds per_transaction_new_payee of ₹500
        currency: 'INR',
        status: 'SENT',
      });

      const res = await request(app)
        .post('/api/invoices/pay')
        .send({ invoiceId: 'INV2-TIER3-HIGH', userId: 'user_meena', confirm: false });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('need_guardian_approval');
      expect(res.body.approvalToken).toBeDefined();
    });
  });

  describe('4. End-to-End Dialogue & Amount Immutability', () => {
    it('completes the sandbox invoice payment on spoken confirmation and marks invoice PAID', async () => {
      createInvoiceRecord(db, {
        merchant_id: 'merchant_ravi_cabs',
        paypal_invoice_id: 'INV2-E2E-PAID',
        amount: 250,
        currency: 'INR',
        status: 'SENT',
      });

      const qrText = 'https://www.sandbox.paypal.com/invoice/p/#INV2-E2E-PAID';
      const sessionId = 'sess-qr-e2e-1';

      // Turn 1: user presents scanned QR text
      const turn1 = await processConversation(db, sessionId, qrText, 'user_meena');
      expect(turn1.state).toBe('awaiting_confirmation');
      expect(turn1.replyText).toContain('Ravi Cabs, 250 rupaye. Kya main bhej doon?');

      // Turn 2: user confirms with "haan"
      const turn2 = await processConversation(db, sessionId, 'haan', 'user_meena');
      expect(turn2.state).toBe('idle');
      expect(turn2.replyText).toContain('Payment safal raha');
      expect(turn2.replyText).toContain('Ravi Cabs');

      // Verify invoice marked as PAID in database
      const updatedInv = getInvoiceByPaypalId(db, 'INV2-E2E-PAID');
      expect(updatedInv?.status).toBe('PAID');
    });

    it('prevents changing the invoice amount by voice', async () => {
      createInvoiceRecord(db, {
        merchant_id: 'merchant_ravi_cabs',
        paypal_invoice_id: 'INV2-IMMUTABLE-AMOUNT',
        amount: 250,
        currency: 'INR',
        status: 'SENT',
      });

      const qrText = 'INV2-IMMUTABLE-AMOUNT';
      const sessionId = 'sess-qr-immutable-1';

      // Turn 1: Present QR
      const turn1 = await processConversation(db, sessionId, qrText, 'user_meena');
      expect(turn1.state).toBe('awaiting_confirmation');

      // Turn 2: User attempts to say a different amount
      const turn2 = await processConversation(db, sessionId, 'nahi 300 rupaye bhejo', 'user_meena');
      expect(turn2.state).toBe('awaiting_confirmation');
      expect(turn2.replyText).toContain('Yeh payment invoice se hai');
      expect(turn2.replyText).toContain('250');
    });
  });
});
