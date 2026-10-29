import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import { addLedgerEntry, getBalance } from '../src/db/repository.js';
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

describe('Conversation Orchestrator (Task 12)', () => {
  let db: Database.Database;
  let testApp: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSessions();
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

  it('multi-turn dialogue: successful payment to trusted contact', async () => {
    mockCreatePayout.mockResolvedValueOnce({
      batch_header: {
        payout_batch_id: 'BATCH-CONV-1',
        batch_status: 'SUCCESS',
      },
    });

    const sessionId = 'session-success-1';

    const turn1 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'Bhaiya ko 500 bhej do' });

    expect(turn1.status).toBe(200);
    expect(turn1.body.state).toBe('awaiting_confirmation');
    expect(turn1.body.replyText).toContain('Bhaiya');
    expect(turn1.body.replyText).toContain('500');
    expect(turn1.body.replyText).toMatch(/haan ya nahi/i);

    const turn2 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'haan' });

    expect(turn2.status).toBe(200);
    expect(turn2.body.state).toBe('idle');
    expect(turn2.body.replyText).toContain('Payment safal raha');
    expect(turn2.body.replyText).toContain('1,500');

    expect(mockCreatePayout).toHaveBeenCalledTimes(1);
    expect(getBalance(db, 'user_meena')).toBe(1500);
  });

  it('multi-turn dialogue: user cancels payment during confirmation', async () => {
    const sessionId = 'session-cancel-1';

    const turn1 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'Bhaiya ko 500 bhej do' });

    expect(turn1.body.state).toBe('awaiting_confirmation');

    const turn2 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'nahi ruko' });

    expect(turn2.status).toBe(200);
    expect(turn2.body.state).toBe('idle');
    expect(turn2.body.replyText).toContain('cancel');

    expect(mockCreatePayout).not.toHaveBeenCalled();
    expect(getBalance(db, 'user_meena')).toBe(2000);
  });

  it('multi-turn dialogue: asks clarifying questions when amount or payee missing', async () => {
    const sessionId = 'session-clarify-1';

    const resNoAmount = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'Bhaiya ko bhej do' });

    expect(resNoAmount.status).toBe(200);
    expect(resNoAmount.body.replyText).toMatch(/amount|kitna/i);
    expect(resNoAmount.body.state).toBe('idle');

    const resNoPayee = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: '500 bhej do' });

    expect(resNoPayee.status).toBe(200);
    expect(resNoPayee.body.replyText).toMatch(/naam|kisko/i);
    expect(resNoPayee.body.state).toBe('idle');
  });

  it('multi-turn dialogue: fails cleanly when balance is insufficient', async () => {
    const emptyDb = createDb(':memory:');
    seedDemoData(emptyDb);
    const emptyApp = createApp(emptyDb);
    const sessionId = 'session-insufficient-1';

    const turn1 = await request(emptyApp)
      .post('/api/converse')
      .send({ sessionId, text: 'Bhaiya ko 500 bhej do' });

    expect(turn1.body.state).toBe('awaiting_confirmation');

    const turn2 = await request(emptyApp)
      .post('/api/converse')
      .send({ sessionId, text: 'haan' });

    expect(turn2.status).toBe(200);
    expect(turn2.body.state).toBe('idle');
    expect(turn2.body.replyText).toContain('paryapt balance nahi hai');
    expect(mockCreatePayout).not.toHaveBeenCalled();
  });

  it('multi-turn dialogue: blocks payment immediately when payee is blocklisted', async () => {
    db.prepare('INSERT INTO blocklist (id, paypal_email, reason) VALUES (?, ?, ?)').run(
      'blk-conv-1',
      'fraudster@scam.com',
      'Impersonation fraud'
    );

    const sessionId = 'session-block-1';

    const res = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'fraudster@scam.com ko 200 bhej do' });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('idle');
    expect(res.body.replyText).toContain('rok diya gaya hai');
  });

  it('multi-turn dialogue: reprompts on unclear confirmation and auto-cancels after 2 attempts', async () => {
    const sessionId = 'session-unclear-1';

    const turn1 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'Bhaiya ko 500 bhej do' });

    expect(turn1.body.state).toBe('awaiting_confirmation');

    const turn2 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'kuch bhi' });

    expect(turn2.status).toBe(200);
    expect(turn2.body.state).toBe('awaiting_confirmation');
    expect(turn2.body.replyText).toContain("Samajh nahi aaya. Kripya 'haan' ya 'nahi' bolein.");

    const turn3 = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'xyzasdf' });

    expect(turn3.status).toBe(200);
    expect(turn3.body.state).toBe('idle');
    expect(turn3.body.replyText).toContain('Do baar samajh nahi aaya');

    expect(mockCreatePayout).not.toHaveBeenCalled();
    expect(getBalance(db, 'user_meena')).toBe(2000);
  });

  it('handles balance check and repeat commands', async () => {
    const sessionId = 'session-misc-1';

    const balanceRes = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'mere paas kitna paisa hai' });

    expect(balanceRes.status).toBe(200);
    expect(balanceRes.body.replyText).toContain('2,000');

    const repeatRes = await request(testApp)
      .post('/api/converse')
      .send({ sessionId, text: 'dobara wahi karo' });

    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.replyText).toContain('2,000');
  });
});
