import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import { addLedgerEntry, getBalance, getTransactionById } from '../src/db/repository.js';
import { clearAllSessions } from '../src/conversation/session.js';

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

import { createPayoutBatch } from '../src/paypal/index.js';
const mockCreatePayout = vi.mocked(createPayoutBatch);

describe('Task 15: Assisted onboarding, contacts and guardian approvals', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.DEMO_AUTH_BYPASS = 'true';
    delete process.env.DEMO_SKIP_COOLING;
    delete process.env.CONTACT_COOLING_OFF_HOURS;
    vi.clearAllMocks();
    clearAllSessions();
    db = createDb(':memory:');
    seedDemoData(db);
    app = createApp(db);

    addLedgerEntry(db, {
      user_id: 'user_meena',
      delta: 5000,
      reason: 'Test funding',
      ref: 'fund_task15',
    });
  });

  describe('Contact Cooling-off Period & Emergency Activation', () => {
    it('new contacts start in cooling_off with activated_at 24 hours later', async () => {
      const res = await request(app).post('/api/contacts').send({
        userId: 'user_meena',
        alias: 'chachi',
        displayName: 'Chachi ji',
        paypalEmail: 'chachi@sandbox.com',
      });

      expect(res.status).toBe(201);
      expect(res.body.contact.status).toBe('cooling_off');
      expect(res.body.inCoolingOff).toBe(true);

      const activatedAt = new Date(res.body.contact.activated_at).getTime();
      const now = Date.now();
      const diffHours = (activatedAt - now) / (3600 * 1000);
      expect(diffHours).toBeGreaterThanOrEqual(23.9);
      expect(diffHours).toBeLessThanOrEqual(24.1);

      // Guardian notification created
      const notifs = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'contact_added');
      expect(notifs.length).toBeGreaterThan(0);
    });

    it('DEMO_SKIP_COOLING=true immediately activates new contacts', async () => {
      process.env.DEMO_SKIP_COOLING = 'true';

      const res = await request(app).post('/api/contacts').send({
        userId: 'user_meena',
        alias: 'didi',
        displayName: 'Didi',
        paypalEmail: 'didi@sandbox.com',
      });

      expect(res.status).toBe(201);
      expect(res.body.contact.status).toBe('active');
      expect(res.body.inCoolingOff).toBe(false);
    });

    it('guardian can block a contact during cooling-off', async () => {
      const createRes = await request(app).post('/api/contacts').send({
        userId: 'user_meena',
        alias: 'suspicious',
        displayName: 'Suspicious Guy',
        paypalEmail: 'scammer@fake.com',
      });

      const contactId = createRes.body.contact.id;

      const blockRes = await request(app).post(`/api/contacts/${contactId}/block`);
      expect(blockRes.status).toBe(200);
      expect(blockRes.body.blocked).toBe(true);

      // Verify contact removed and added to blocklist
      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
      expect(contact).toBeUndefined();

      const blocklistItem = db
        .prepare('SELECT * FROM blocklist WHERE LOWER(paypal_email) = ?')
        .get('scammer@fake.com');
      expect(blocklistItem).toBeDefined();
    });

    it('emergency: guardian can instantly activate a contact in cooling-off', async () => {
      const createRes = await request(app).post('/api/contacts').send({
        userId: 'user_meena',
        alias: 'doctor',
        displayName: 'Family Doctor',
        paypalEmail: 'doctor@sandbox.com',
      });

      const contactId = createRes.body.contact.id;
      expect(createRes.body.contact.status).toBe('cooling_off');

      const activateRes = await request(app).post(`/api/contacts/${contactId}/activate`);
      expect(activateRes.status).toBe(200);
      expect(activateRes.body.contact.status).toBe('active');
    });

    it('emergency: guardian can grant a one-time higher limit', async () => {
      const res = await request(app).post('/api/family/emergency-limit').send({
        userId: 'user_meena',
        additionalDailyLimit: 10000,
        perPaymentLimit: 5000,
      });

      expect(res.status).toBe(200);
      expect(res.body.limits.daily_total).toBeGreaterThanOrEqual(11000);

      // Notification with spoken text created
      const notifs = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'emergency_limit_granted') as Array<{ spoken_text: string }>;

      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].spoken_text).toContain('limit badha di gayi hai');
    });
  });

  describe('Guardian Approvals Flow', () => {
    it('Tier 3 payment generates approval token and waits for guardian decision', async () => {
      // Lower limits so ₹2000 payment triggers need_guardian_approval
      db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(
        JSON.stringify({ daily_total: 500, per_transaction_new_payee: 200, max_new_payees_per_day: 1 }),
        'user_meena'
      );

      // 1. User attempts to send ₹2000 to Bhaiya
      const prepRes = await request(app).post('/api/payments/prepare').send({
        userId: 'user_meena',
        payee: 'Bhaiya',
        amount: 2000,
      });

      expect(prepRes.status).toBe(200);
      expect(prepRes.body.decision.action).toBe('need_guardian_approval');
      expect(prepRes.body.approvalToken).toBeDefined();
      expect(prepRes.body.approvalUrl).toMatch(/\/approve\/[a-zA-Z0-9]+/);

      const token = prepRes.body.approvalToken;

      // 2. Guardian opens approval page /api/approvals/:token
      const getRes = await request(app).get(`/api/approvals/${token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.amount).toBe(2000);
      expect(getRes.body.payee).toBe('Bhaiya');
      expect(getRes.body.status).toBe('pending');
      expect(getRes.body.isExpired).toBe(false);

      // 3. User cannot confirm while pending
      const confirmBefore = await request(app).post('/api/payments/confirm').send({
        transactionId: prepRes.body.transactionId,
        userConfirmed: true,
      });
      expect(confirmBefore.status).toBe(400);

      // 4. Guardian approves
      const decideRes = await request(app).post(`/api/approvals/${token}/decide`).send({
        decision: 'approve',
        note: 'Approved for family expense',
      });
      expect(decideRes.status).toBe(200);
      expect(decideRes.body.status).toBe('approved');

      // 5. Check user notification is ready with spoken text
      const notifs = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'approval_granted') as Array<{ spoken_text: string }>;

      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].spoken_text).toContain('manzoori de di hai');

      // 6. User confirms out loud -> payment completes
      mockCreatePayout.mockResolvedValueOnce({
        batch_header: { payout_batch_id: 'BATCH-APPR-1', batch_status: 'SUCCESS' },
      });

      const confirmAfter = await request(app).post('/api/payments/confirm').send({
        transactionId: prepRes.body.transactionId,
        userConfirmed: true,
      });

      expect(confirmAfter.status).toBe(200);
      expect(confirmAfter.body.status).toBe('completed');
      expect(mockCreatePayout).toHaveBeenCalledTimes(1);
    });

    it('guardian denying payment marks transaction failed and notifies user', async () => {
      db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(
        JSON.stringify({ daily_total: 500, per_transaction_new_payee: 200, max_new_payees_per_day: 1 }),
        'user_meena'
      );

      const prepRes = await request(app).post('/api/payments/prepare').send({
        userId: 'user_meena',
        payee: 'Bhaiya',
        amount: 1500,
      });

      const token = prepRes.body.approvalToken;

      // Guardian denies
      const decideRes = await request(app).post(`/api/approvals/${token}/decide`).send({
        decision: 'deny',
        note: 'Too much money right now',
      });

      expect(decideRes.status).toBe(200);
      expect(decideRes.body.status).toBe('denied');

      const tx = getTransactionById(db, prepRes.body.transactionId);
      expect(tx?.status).toBe('failed');

      // Rejection notification
      const notifs = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'approval_denied') as Array<{ spoken_text: string }>;

      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].spoken_text).toContain('reject kar diya hai');

      // Confirmation fails
      const confirmAfter = await request(app).post('/api/payments/confirm').send({
        transactionId: prepRes.body.transactionId,
        userConfirmed: true,
      });
      expect(confirmAfter.status).toBe(400);
    });

    it('expired approval token is rejected', async () => {
      db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(
        JSON.stringify({ daily_total: 500, per_transaction_new_payee: 200, max_new_payees_per_day: 1 }),
        'user_meena'
      );

      const prepRes = await request(app).post('/api/payments/prepare').send({
        userId: 'user_meena',
        payee: 'Bhaiya',
        amount: 1500,
      });

      const token = prepRes.body.approvalToken;

      // Manually set expiration in the past
      const pastTime = new Date(Date.now() - 60 * 1000).toISOString();
      db.prepare('UPDATE approvals SET expires_at = ? WHERE token = ?').run(pastTime, token);

      const decideRes = await request(app).post(`/api/approvals/${token}/decide`).send({
        decision: 'approve',
      });

      expect(decideRes.status).toBe(400);
      expect(decideRes.body.error).toContain('expired');
    });
  });

  describe('Assisted Onboarding Wizard', () => {
    it('completes onboarding setup with profile, guardian and contacts', async () => {
      const res = await request(app).post('/api/onboarding/complete').send({
        userId: 'user_new',
        name: 'Savitri Devi',
        language: 'hi',
        limits: {
          daily_total: 2000,
          per_transaction_new_payee: 600,
          max_new_payees_per_day: 3,
        },
        guardian: {
          name: 'Alok',
          contact: '+919876543210',
          permissions: 'all',
        },
        contacts: [
          {
            alias: 'beta',
            displayName: 'Alok (Beta)',
            paypalEmail: 'alok@sandbox.com',
          },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe('Savitri Devi');
      expect(res.body.contacts.length).toBe(1);
      expect(res.body.contacts[0].alias).toBe('beta');
    });
  });
});
