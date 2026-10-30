import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { createSession, destroySession, getSessionUser } from './session.js';

export const FAMILY_SESSION_COOKIE = 'awaaz_family_session';
export const FAMILY_SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const FAMILY_SESSION_USER_ID = 'family_portal';

export function issueFamilySession(res: Response): void {
  const token = createSession(FAMILY_SESSION_USER_ID);
  res.cookie(FAMILY_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: FAMILY_SESSION_MAX_AGE,
  });
}

export function clearFamilySession(req: Request, res: Response): void {
  const token = req.cookies?.[FAMILY_SESSION_COOKIE];
  if (token) destroySession(token);
  res.clearCookie(FAMILY_SESSION_COOKIE, { sameSite: 'lax', secure: config.NODE_ENV === 'production' });
}

export function hasFamilySession(req: Request): boolean {
  const token = req.cookies?.[FAMILY_SESSION_COOKIE];
  if (!token) return false;

  const session = getSessionUser(token);
  if (!session || session.userId !== FAMILY_SESSION_USER_ID) return false;
  if (Date.now() - session.createdAt > FAMILY_SESSION_MAX_AGE) {
    destroySession(token);
    return false;
  }
  return true;
}

export function requireFamilyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!hasFamilySession(req)) {
    res.status(401).json({ error: 'Family portal login required' });
    return;
  }
  next();
}

export function verifyFamilyCredentials(email: unknown, password: unknown): boolean {
  const expectedEmail = config.FAMILY_DASHBOARD_EMAIL?.trim().toLowerCase();
  const expectedPassword = config.FAMILY_DASHBOARD_PASSWORD;
  if (!expectedEmail || !expectedPassword || typeof email !== 'string' || typeof password !== 'string') return false;

  const emailMatches = email.trim().toLowerCase() === expectedEmail;
  const submittedPassword = Buffer.from(password);
  const expectedPasswordBuffer = Buffer.from(expectedPassword);
  const passwordMatches = submittedPassword.length === expectedPasswordBuffer.length
    && crypto.timingSafeEqual(submittedPassword, expectedPasswordBuffer);
  return emailMatches && passwordMatches;
}
