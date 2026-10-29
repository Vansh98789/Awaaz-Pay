import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/connection.js';
import { seedDemoData } from '../src/db/seed.js';
import {
  calculateFuzzyMatchScore,
  verifyVoiceChallenge,
  getVoiceChallengePhrase,
} from '../src/auth/voiceChallenge.js';
import {
  createSession,
  clearAllAuthStores,
  SESSION_COOKIE_NAME,
} from '../src/auth/session.js';

describe('Task 14: Authentication & Voice Challenge', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    // Ensure DEMO_AUTH_BYPASS is off by default
    delete process.env.DEMO_AUTH_BYPASS;
    clearAllAuthStores();
    db = createDb(':memory:');
    seedDemoData(db);
    app = createApp(db);
  });

  describe('Voice Challenge & Fuzzy Match', () => {
    it('returns 1.0 for exact match', () => {
      const score = calculateFuzzyMatchScore(
        'Mera naam Meena hai',
        'Mera naam Meena hai'
      );
      expect(score).toBe(1);
    });

    it('returns high score for case, whitespace and punctuation variations', () => {
      const score = calculateFuzzyMatchScore(
        'Mera naam Meena hai',
        'mera naam meena hai!'
      );
      expect(score).toBe(1);
    });

    it('returns high score for minor spoken transcription differences', () => {
      // e.g. "surakshit" vs "surkshit"
      const score = calculateFuzzyMatchScore(
        'Awaaz Pay surakshit batua hai',
        'Awaaz Pay surkshit batua hai'
      );
      expect(score).toBeGreaterThanOrEqual(0.75);
    });

    it('returns low score for completely different phrase', () => {
      const score = calculateFuzzyMatchScore(
        'Mera naam Meena hai',
        'Aaj mausam bahut achha hai'
      );
      expect(score).toBeLessThan(0.3);
    });

    it('returns 0 for empty or blank input', () => {
      expect(calculateFuzzyMatchScore('Mera naam Meena hai', '')).toBe(0);
      expect(calculateFuzzyMatchScore('', 'Mera naam Meena hai')).toBe(0);
    });

    it('voice challenge failure logs an audit event and marks isSecondarySignalOnly', () => {
      const challenge = getVoiceChallengePhrase();

      const result = verifyVoiceChallenge(
        db,
        'user_meena',
        challenge.id,
        'Galat jawab kuch bhi'
      );

      expect(result.passed).toBe(false);
      expect(result.isSecondarySignalOnly).toBe(true);

      // Verify audit event was written
      const audit = db
        .prepare('SELECT * FROM audit_events WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'voice_challenge_failed') as Array<{ payload: string }>;

      expect(audit.length).toBeGreaterThan(0);
      const payload = JSON.parse(audit[0].payload);
      expect(payload.isSecondarySignalOnly).toBe(true);
      expect(payload.challengeId).toBe(challenge.id);
    });

    it('voice challenge success logs audit event', () => {
      const challenge = getVoiceChallengePhrase();

      const result = verifyVoiceChallenge(
        db,
        'user_meena',
        challenge.id,
        challenge.phrase
      );

      expect(result.passed).toBe(true);
      expect(result.score).toBe(1);
      expect(result.isSecondarySignalOnly).toBe(true);

      const audit = db
        .prepare('SELECT * FROM audit_events WHERE user_id = ? AND kind = ?')
        .all('user_meena', 'voice_challenge_passed');

      expect(audit.length).toBeGreaterThan(0);
    });
  });

  describe('Protected Routes (Anonymous Rejection)', () => {
    it('rejects anonymous calls to /api/converse with 401', async () => {
      const res = await request(app)
        .post('/api/converse')
        .send({ text: 'mere paas kitna paisa hai' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/passkey|authentication required/i);
    });

    it('rejects anonymous calls to /api/payments/prepare with 401', async () => {
      const res = await request(app)
        .post('/api/payments/prepare')
        .send({ payee: 'Bhaiya', amount: 500 });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/passkey|authentication required/i);
    });

    it('rejects anonymous calls to /api/auth/me with 401', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe('Session Cookie Authentication', () => {
    it('allows access to protected routes when valid session cookie is provided', async () => {
      const token = createSession('user_meena');

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

      expect(meRes.status).toBe(200);
      expect(meRes.body.authenticated).toBe(true);
      expect(meRes.body.userId).toBe('user_meena');

      const convRes = await request(app)
        .post('/api/converse')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`])
        .send({ text: 'mere paas kitna paisa hai' });

      expect(convRes.status).toBe(200);
      expect(convRes.body.replyText).toContain('rupaye');
    });

    it('allows logout to clear session', async () => {
      const token = createSession('user_meena');

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Subsequent call should fail with 401
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

      expect(meRes.status).toBe(401);
    });
  });

  describe('DEMO_AUTH_BYPASS Flag', () => {
    it('allows anonymous access when DEMO_AUTH_BYPASS is set to true', async () => {
      process.env.DEMO_AUTH_BYPASS = 'true';

      const meRes = await request(app).get('/api/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.authenticated).toBe(true);
      expect(meRes.body.bypass).toBe(true);

      const convRes = await request(app)
        .post('/api/converse')
        .send({ text: 'mere paas kitna paisa hai' });

      expect(convRes.status).toBe(200);
      expect(convRes.body.replyText).toContain('rupaye');
    });
  });

  describe('WebAuthn Endpoints', () => {
    it('generates registration options with challenge', async () => {
      const res = await request(app)
        .post('/api/auth/register-options')
        .send({ userId: 'user_meena' });

      expect(res.status).toBe(200);
      expect(res.body.challenge).toBeDefined();
      expect(res.body.rp.name).toBe('Awaaz Pay');
      expect(res.body.user.name).toBe('Meena');
    });

    it('generates login options with challenge', async () => {
      const res = await request(app)
        .post('/api/auth/login-options')
        .send({ userId: 'user_meena' });

      expect(res.status).toBe(200);
      expect(res.body.challenge).toBeDefined();
    });

    it('returns voice challenge phrase via API', async () => {
      const res = await request(app).get('/api/auth/voice-challenge');

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.phrase).toBeDefined();
      expect(res.body.instructionHindi).toContain('Kripya yeh bolein');
      expect(res.body.isSecondarySignalOnly).toBe(true);
    });
  });
});
