import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import {
  getUserById,
  savePasskey,
  getPasskeysByUserId,
  getPasskeyById,
  updatePasskeyCounter,
} from '../db/repository.js';
import {
  createSession,
  destroySession,
  getSessionUser,
  setChallenge,
  getChallenge,
  clearChallenge,
  SESSION_COOKIE_NAME,
} from '../auth/session.js';
import {
  getVoiceChallengePhrase,
  verifyVoiceChallenge,
} from '../auth/voiceChallenge.js';
import { isDemoAuthBypass } from '../auth/middleware.js';

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  const rpName = process.env.RP_NAME || 'Awaaz Pay';
  const rpID = process.env.RP_ID || 'localhost';
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3001',
  ];
  if (process.env.ORIGIN) {
    allowedOrigins.push(process.env.ORIGIN);
  }

  // 1. Generate Registration Options
  router.post('/register-options', async (req: Request, res: Response) => {
    try {
      const { userId = 'user_meena' } = req.body;
      const user = getUserById(db, userId);
      const userName = user?.name || 'Meena';

      const existingPasskeys = getPasskeysByUserId(db, userId);

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName,
        userID: new TextEncoder().encode(userId),
        userDisplayName: `${userName} (Awaaz Pay)`,
        attestationType: 'none',
        excludeCredentials: existingPasskeys.map((p) => ({
          id: p.id,
          transports: p.transports ? JSON.parse(p.transports) : undefined,
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      });

      setChallenge(userId, options.challenge, 'registration');

      res.status(200).json(options);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Verify Registration Response
  router.post('/verify-registration', async (req: Request, res: Response) => {
    try {
      const { userId = 'user_meena', response } = req.body;
      if (!response) {
        res.status(400).json({ error: 'WebAuthn response is required' });
        return;
      }

      const expectedChallenge = getChallenge(userId, 'registration');
      if (!expectedChallenge) {
        res.status(400).json({ error: 'No pending registration challenge found' });
        return;
      }

      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: allowedOrigins,
        expectedRPID: rpID,
        requireUserVerification: false,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential, credentialDeviceType, credentialBackedUp } =
          verification.registrationInfo;

        savePasskey(db, {
          id: credential.id,
          user_id: userId,
          public_key: Buffer.from(credential.publicKey).toString('base64'),
          counter: credential.counter,
          device_type: credentialDeviceType,
          backed_up: credentialBackedUp ? 1 : 0,
          transports: credential.transports ? JSON.stringify(credential.transports) : null,
          created_at: new Date().toISOString(),
        });

        clearChallenge(userId, 'registration');

        const sessionToken = createSession(userId);
        res.cookie(SESSION_COOKIE_NAME, sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000,
        });

        res.status(200).json({
          verified: true,
          userId,
          token: sessionToken,
        });
        return;
      }

      res.status(400).json({ verified: false, error: 'Registration verification failed' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Generate Login / Authentication Options
  router.post('/login-options', async (req: Request, res: Response) => {
    try {
      const { userId = 'user_meena' } = req.body;
      const userPasskeys = getPasskeysByUserId(db, userId);

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: userPasskeys.map((p) => ({
          id: p.id,
          transports: p.transports ? JSON.parse(p.transports) : undefined,
        })),
        userVerification: 'preferred',
      });

      setChallenge(userId, options.challenge, 'authentication');

      res.status(200).json(options);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Verify Login / Authentication Response
  router.post('/verify-login', async (req: Request, res: Response) => {
    try {
      const { userId = 'user_meena', response } = req.body;
      if (!response || !response.id) {
        res.status(400).json({ error: 'Valid WebAuthn authentication response required' });
        return;
      }

      const passkey = getPasskeyById(db, response.id);
      if (!passkey) {
        res.status(404).json({ error: 'Passkey not found in database' });
        return;
      }

      const expectedChallenge = getChallenge(userId, 'authentication');
      if (!expectedChallenge) {
        res.status(400).json({ error: 'No pending authentication challenge found' });
        return;
      }

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: allowedOrigins,
        expectedRPID: rpID,
        credential: {
          id: passkey.id,
          publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64')),
          counter: passkey.counter,
          transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
        },
        requireUserVerification: false,
      });

      if (verification.verified) {
        updatePasskeyCounter(db, passkey.id, verification.authenticationInfo.newCounter);
        clearChallenge(userId, 'authentication');

        const sessionToken = createSession(passkey.user_id);
        res.cookie(SESSION_COOKIE_NAME, sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000,
        });

        res.status(200).json({
          verified: true,
          userId: passkey.user_id,
          token: sessionToken,
        });
        return;
      }

      res.status(400).json({ verified: false, error: 'Authentication verification failed' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 5. Voice Challenge - Generate
  router.get('/voice-challenge', (_req: Request, res: Response) => {
    const challenge = getVoiceChallengePhrase();
    res.status(200).json({
      ...challenge,
      isSecondarySignalOnly: true,
      notice: 'Voice challenge is used solely as a risk signal, never as the only lock.',
    });
  });

  // 6. Voice Challenge - Verify
  router.post('/voice-challenge/verify', (req: Request, res: Response) => {
    try {
      const { challengeId, transcript, userId = 'user_meena' } = req.body;
      if (!challengeId || typeof transcript !== 'string') {
        res.status(400).json({ error: 'challengeId and transcript are required' });
        return;
      }

      const result = verifyVoiceChallenge(db, userId, challengeId, transcript);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 7. Check current session
  router.get('/me', (req: Request, res: Response) => {
    if (isDemoAuthBypass()) {
      res.status(200).json({
        authenticated: true,
        userId: 'user_meena',
        bypass: true,
      });
      return;
    }

    let token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    }

    if (!token) {
      res.status(401).json({ authenticated: false, error: 'No active session' });
      return;
    }

    const session = getSessionUser(token);
    if (!session) {
      res.status(401).json({ authenticated: false, error: 'Session expired' });
      return;
    }

    res.status(200).json({
      authenticated: true,
      userId: session.userId,
    });
  });

  // 8. Logout
  router.post('/logout', (req: Request, res: Response) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      destroySession(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(200).json({ success: true });
  });

  return router;
}
