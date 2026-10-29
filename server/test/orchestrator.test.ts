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

vi.mock('../src/llm/index.js', () => {
  class LLMUnavailableError extends Error {
    providers: string[];
    constructor(providers: string[] = ['gemini', 'groq']) {
      super(`All LLM providers failed: ${providers.join(', ')}`);
      this.name = 'LLMUnavailableError';
      this.providers = providers;
    }
  }
  return {
    completeJson: vi.fn().mockRejectedValue(new LLMUnavailableError()),
    LLMUnavailableError,
  };
});

import { createPayoutBatch } from '../src/paypal/index.js';
import { completeJson, LLMUnavailableError } from '../src/llm/index.js';
const mockCreatePayout = vi.mocked(createPayoutBatch);
const mockCompleteJson = vi.mocked(completeJson);

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

  describe('Task 13: Scam interview and guardian alerts', () => {
    it('scripted dialogue: user says someone told them to pay a prize fee gets blocked with calm interruption and guardian alert', async () => {
      const sessionId = 'session-scam-block-1';

      // Turn 1: User initiates payment to unknown recipient / prize account
      const turn1 = await request(testApp)
        .post('/api/converse')
        .send({ sessionId, text: 'winner@lottery.com ko 500 bhej do' });

      expect(turn1.status).toBe(200);
      expect(turn1.body.state).toBe('awaiting_scam_answers');
      expect(turn1.body.replyText).toContain('Kya kisi ne phone ya message par aapko ye payment karne ko kaha hai?');

      // Turn 2: User responds saying someone told them to pay prize fee
      const turn2 = await request(testApp)
        .post('/api/converse')
        .send({
          sessionId,
          text: 'Haan phone par bola tha prize fee bhej do tab lottery milegi',
        });

      expect(turn2.status).toBe(200);
      expect(turn2.body.state).toBe('idle');
      // Calm interruption: this may be a scam, real banks or police never ask, stopping payment, call family
      expect(turn2.body.replyText).toContain('scam ho sakta hai');
      expect(turn2.body.replyText).toContain('Asli bank ya police kabhi bhi is tarah phone par OTP ya paise nahi maangte');
      expect(turn2.body.replyText).toContain('Main yeh payment rok rahi hoon');
      expect(turn2.body.replyText).toContain('parivaar');

      // Payout must not be called
      expect(mockCreatePayout).not.toHaveBeenCalled();

      // Check guardian notification created in DB
      const notifications = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'scam_alert') as Array<{ message: string; spoken_text: string }>;

      expect(notifications.length).toBeGreaterThan(0);
      const notif = notifications[0];
      expect(notif.message).toMatch(/500/);
      expect(notif.message).toMatch(/winner@lottery\.com/);
      expect(notif.message).toMatch(/prize_lottery|refund_or_fee|caller|High scam risk/i);

      // Check audit event written
      const audit = db
        .prepare('SELECT * FROM audit_events WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'scam_payment_blocked');
      expect(audit.length).toBeGreaterThan(0);

      // Check transaction recorded with status failed
      const tx = db
        .prepare('SELECT * FROM transactions WHERE user_id = ? AND status = ? AND decision = ?')
        .get('user_meena', 'failed', 'block');
      expect(tx).toBeDefined();
    });

    it('normal payment to a verified merchant passes scam interview when all answers are no', async () => {
      mockCreatePayout.mockResolvedValueOnce({
        batch_header: {
          payout_batch_id: 'BATCH-MERCHANT-PASS',
          batch_status: 'SUCCESS',
        },
      });

      const sessionId = 'session-merchant-pass-1';

      // Turn 1: Pay verified merchant (Ravi Cabs, Tier 2)
      const turn1 = await request(testApp)
        .post('/api/converse')
        .send({ sessionId, text: 'Ravi Cabs ko 200 bhej do' });

      expect(turn1.status).toBe(200);
      expect(turn1.body.state).toBe('awaiting_scam_answers');
      expect(turn1.body.replyText).toContain('Kya kisi ne phone ya message par aapko ye payment karne ko kaha hai?');

      // Turn 2: Answer NO to being told to pay
      const turn2 = await request(testApp)
        .post('/api/converse')
        .send({ sessionId, text: 'nahi' });

      expect(turn2.status).toBe(200);
      expect(turn2.body.state).toBe('awaiting_scam_answers');
      // For new payee (merchant), asks Question 2:
      expect(turn2.body.replyText).toContain('Kya aap is insaan ko jaante hain?');

      // Turn 3: Answer NO to knowing payee personally (all answers are no)
      const turn3 = await request(testApp)
        .post('/api/converse')
        .send({ sessionId, text: 'nahi' });

      expect(turn3.status).toBe(200);
      // Low risk continues -> enters awaiting_confirmation!
      expect(turn3.body.state).toBe('awaiting_confirmation');
      expect(turn3.body.replyText).toContain('Ravi Cabs');
      expect(turn3.body.replyText).toContain('200');
      expect(turn3.body.replyText).toMatch(/haan ya nahi/i);

      // Turn 4: User confirms out loud
      const turn4 = await request(testApp)
        .post('/api/converse')
        .send({ sessionId, text: 'haan kar do' });

      expect(turn4.status).toBe(200);
      expect(turn4.body.state).toBe('idle');
      expect(turn4.body.replyText).toContain('Payment safal raha');
      expect(mockCreatePayout).toHaveBeenCalledTimes(1);
      expect(getBalance(db, 'user_meena')).toBe(1800);
    });

    it('LLM-down fallback: keyword detector alone blocks scam payment without LLM', async () => {
      // Ensure completeJson rejects with LLMUnavailableError
      mockCompleteJson.mockRejectedValue(new LLMUnavailableError(['gemini', 'groq']));

      const sessionId = 'session-llm-down-1';

      // Turn 1: User says payment for prize fee
      const turn1 = await request(testApp)
        .post('/api/converse')
        .send({ sessionId, text: 'fraud@prize.com ko 300 bhej do' });

      expect(turn1.status).toBe(200);
      expect(turn1.body.state).toBe('awaiting_scam_answers');
      expect(turn1.body.replyText).toContain('Kya kisi ne phone ya message par aapko ye payment karne ko kaha hai?');

      // Turn 2: User responds with caller instruction and prize keyword
      const turn2 = await request(testApp)
        .post('/api/converse')
        .send({
          sessionId,
          text: 'haan lottery prize fee bharne ko bola hai',
        });

      expect(turn2.status).toBe(200);
      expect(turn2.body.state).toBe('idle');
      expect(turn2.body.replyText).toContain('scam ho sakta hai');
      expect(turn2.body.replyText).toContain('Main yeh payment rok rahi hoon');

      expect(mockCreatePayout).not.toHaveBeenCalled();

      // Check notification created
      const notifs = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'scam_alert');
      expect(notifs.length).toBeGreaterThan(0);
    });
  });
});
