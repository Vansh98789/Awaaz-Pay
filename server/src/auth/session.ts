import crypto from 'node:crypto';

export const SESSION_COOKIE_NAME = 'awaaz_session';

export interface SessionInfo {
  userId: string;
  createdAt: number;
}

export interface ChallengeInfo {
  challenge: string;
  type: 'registration' | 'authentication';
  expiresAt: number;
}

const sessionStore = new Map<string, SessionInfo>();
const challengeStore = new Map<string, ChallengeInfo>();

export function createSession(userId: string): string {
  const token = crypto.randomUUID();
  sessionStore.set(token, {
    userId,
    createdAt: Date.now(),
  });
  return token;
}

export function getSessionUser(token: string): SessionInfo | null {
  if (!token) return null;
  return sessionStore.get(token) ?? null;
}

export function destroySession(token: string): void {
  if (token) {
    sessionStore.delete(token);
  }
}

export function setChallenge(
  userId: string,
  challenge: string,
  type: 'registration' | 'authentication'
): void {
  challengeStore.set(`${userId}:${type}`, {
    challenge,
    type,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });
}

export function getChallenge(
  userId: string,
  type: 'registration' | 'authentication'
): string | null {
  const key = `${userId}:${type}`;
  const info = challengeStore.get(key);
  if (!info) return null;
  if (Date.now() > info.expiresAt) {
    challengeStore.delete(key);
    return null;
  }
  return info.challenge;
}

export function clearChallenge(
  userId: string,
  type: 'registration' | 'authentication'
): void {
  challengeStore.delete(`${userId}:${type}`);
}

export function clearAllAuthStores(): void {
  sessionStore.clear();
  challengeStore.clear();
}
