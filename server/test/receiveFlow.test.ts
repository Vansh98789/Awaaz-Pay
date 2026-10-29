import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import { getBalance } from '../src/db/repository.js';

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

import { createOrder, captureOrder, verifyWebhookSignature } from '../src/paypal/index.js';

const mockCreateOrder = vi.mocked(createOrder);
const mockCaptureOrder = vi.mocked(captureOrder);
const mockVerifyWebhook = vi.mocked(verifyWebhookSignature);

function createWebhookHeaders(overrides: Record<string, string> = {}) {
  return {
    'paypal-transmission-id': 'trans-12345',
    'paypal-transmission-time': '2026-10-29T10:00:00Z',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'mock-sig',
    ...overrides,
  };
}

function createSampleCapturePayload(eventId = 'EVT-100', amount = 500, senderName = 'Ramesh') {
  return {
    id: eventId,
    event_version: '1.0',
    create_time: '2026-10-29T10:00:00Z',
    resource_type: 'capture',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    summary: 'Payment capture completed',
    resource: {
      id: `CAP-${eventId}`,
      amount: {
        value: amount.toFixed(2),
        currency_code: 'USD',
      },
      status: 'COMPLETED',
      custom_id: 'user_meena',
      payer: {
        name: {
          given_name: senderName,
        },
        email_address: 'ramesh@example.com',
      },
    },
  };
}

describe('Receive Money Flow', () => {
  let db: Database.Database;
  let testApp: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDb(':memory:');
    seedDemoData(db);
    testApp = createApp(db);
  });

  describe('POST /api/family/fund-order', () => {
    it('creates PayPal order and returns approvalUrl', async () => {
      mockCreateOrder.mockResolvedValueOnce({
        id: 'ORDER-FAM-1',
        status: 'CREATED',
        links: [
          { href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER-FAM-1', rel: 'approve', method: 'GET' },
          { href: 'https://api.sandbox.paypal.com/v2/checkout/orders/ORDER-FAM-1', rel: 'self', method: 'GET' },
        ],
      });

      const res = await request(testApp)
        .post('/api/family/fund-order')
        .send({ amount: 500, currency: 'USD', userId: 'user_meena' });

      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe('ORDER-FAM-1');
      expect(res.body.approvalUrl).toBe('https://sandbox.paypal.com/checkoutnow?token=ORDER-FAM-1');
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 500,
          currency: 'USD',
          description: expect.stringContaining('Meena'),
        })
      );
    });

    it('rejects invalid or non-positive amount', async () => {
      const res = await request(testApp)
        .post('/api/family/fund-order')
        .send({ amount: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Valid positive amount');
    });
  });

  describe('POST /api/family/capture', () => {
    it('captures order, credits ledger, and creates Hindi notification', async () => {
      mockCaptureOrder.mockResolvedValueOnce({
        id: 'ORDER-FAM-2',
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: 'CAP-999',
                  status: 'COMPLETED',
                  amount: { value: '500.00', currency_code: 'USD' },
                },
              ],
            },
          },
        ],
      });

      const res = await request(testApp)
        .post('/api/family/capture')
        .send({ orderId: 'ORDER-FAM-2', userId: 'user_meena', senderName: 'Ramesh' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.amount).toBe(500);
      expect(res.body.balance).toBe(500);

      const balance = getBalance(db, 'user_meena');
      expect(balance).toBe(500);

      const pendingRes = await request(testApp)
        .get('/api/notifications/pending?userId=user_meena');

      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.notifications).toHaveLength(1);
      expect(pendingRes.body.notifications[0].spoken_text).toContain('Ramesh ne 500 rupaye bheje');
      expect(pendingRes.body.notifications[0].spoken_text).toContain('500 rupaye hain');
    });
  });

  describe('POST /api/webhooks/paypal', () => {
    it('verifies signature, credits ledger, and creates pending notification', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(true);

      const payload = createSampleCapturePayload('EVT-1', 500, 'Ramesh');
      const headers = createWebhookHeaders();

      const res = await request(testApp)
        .post('/api/webhooks/paypal')
        .set(headers)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.amount).toBe(500);
      expect(res.body.balance).toBe(500);

      const balance = getBalance(db, 'user_meena');
      expect(balance).toBe(500);

      const pendingRes = await request(testApp).get('/api/notifications/pending?userId=user_meena');
      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.notifications).toHaveLength(1);
      expect(pendingRes.body.notifications[0].spoken_text).toBe(
        'Ramesh ne 500 rupaye bheje. Aapke paas ab 500 rupaye hain.'
      );
    });

    it('enforces idempotency and ignores duplicate webhook event id', async () => {
      mockVerifyWebhook.mockResolvedValue(true);

      const payload = createSampleCapturePayload('EVT-DUP', 750, 'Ramesh');
      const headers = createWebhookHeaders();

      const firstRes = await request(testApp)
        .post('/api/webhooks/paypal')
        .set(headers)
        .send(payload);

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.status).toBe('success');
      expect(getBalance(db, 'user_meena')).toBe(750);

      const secondRes = await request(testApp)
        .post('/api/webhooks/paypal')
        .set(headers)
        .send(payload);

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.status).toBe('ignored_duplicate');

      expect(getBalance(db, 'user_meena')).toBe(750);

      const pendingRes = await request(testApp).get('/api/notifications/pending?userId=user_meena');
      expect(pendingRes.body.notifications).toHaveLength(1);
    });

    it('rejects request with invalid signature with 400', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(false);

      const payload = createSampleCapturePayload('EVT-BAD-SIG', 100);
      const headers = createWebhookHeaders();

      const res = await request(testApp)
        .post('/api/webhooks/paypal')
        .set(headers)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid webhook signature');
      expect(getBalance(db, 'user_meena')).toBe(0);
    });

    it('rejects request with missing verification headers with 400', async () => {
      const payload = createSampleCapturePayload('EVT-NO-HEADERS', 100);

      const res = await request(testApp)
        .post('/api/webhooks/paypal')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing PayPal webhook verification headers');
      expect(mockVerifyWebhook).not.toHaveBeenCalled();
    });
  });

  describe('Notifications workflow', () => {
    it('marks pending notifications as delivered', async () => {
      mockVerifyWebhook.mockResolvedValueOnce(true);
      const payload = createSampleCapturePayload('EVT-NOTIF-TEST', 250, 'Ramesh');
      await request(testApp)
        .post('/api/webhooks/paypal')
        .set(createWebhookHeaders())
        .send(payload);

      const pendingBefore = await request(testApp).get('/api/notifications/pending?userId=user_meena');
      expect(pendingBefore.body.notifications).toHaveLength(1);
      const notifId = pendingBefore.body.notifications[0].id;

      const markRes = await request(testApp).post(`/api/notifications/${notifId}/delivered`);
      expect(markRes.status).toBe(200);
      expect(markRes.body.success).toBe(true);

      const pendingAfter = await request(testApp).get('/api/notifications/pending?userId=user_meena');
      expect(pendingAfter.body.notifications).toHaveLength(0);
    });
  });
});
