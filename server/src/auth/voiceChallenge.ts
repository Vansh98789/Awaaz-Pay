import crypto from 'node:crypto';
import type { AppDatabase as Database } from '../db/connection.js';
import { writeAudit } from '../db/repository.js';
import { normalizeText } from '../safety/normalize.js';

/**
 * ---------------------------------------------------------------------------------
 * CRITICAL ARCHITECTURAL PRINCIPLE: VOICE CHALLENGE IS A SECONDARY RISK SIGNAL ONLY
 * ---------------------------------------------------------------------------------
 * As specified in docs/DESIGN.md Section 5.5:
 *   "Voice match is a risk signal: a low match adds checks instead of silently blocking.
 *    A random-phrase challenge defeats simple replay, not a live clone.
 *    Say plainly: voice is one signal, not the key."
 *
 * A failed voice challenge logs an audit event and flags risk in the user's session.
 * It MUST NEVER be used as the sole hard lock or binary authenticator, as speech
 * recognition in loud environments or with accents can produce false negatives.
 * Primary authentication is provided by WebAuthn fingerprint passkeys.
 * ---------------------------------------------------------------------------------
 */

export const VOICE_CHALLENGE_PHRASES = [
  'Mera naam Meena hai',
  'Awaaz Pay surakshit batua hai',
  'Main payment karna chahti hoon',
  'Neela kela saat',
  'Mujhe paise bhejne hain',
  'Yeh mera phone hai',
];

export interface VoiceChallengeItem {
  id: string;
  phrase: string;
  instructionHindi: string;
  instructionEnglish: string;
}

const activeChallenges = new Map<string, { phrase: string; expiresAt: number }>();

export function getVoiceChallengePhrase(): VoiceChallengeItem {
  const index = Math.floor(Math.random() * VOICE_CHALLENGE_PHRASES.length);
  const phrase = VOICE_CHALLENGE_PHRASES[index];
  const id = crypto.randomUUID();

  activeChallenges.set(id, {
    phrase,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return {
    id,
    phrase,
    instructionHindi: `Kripya yeh bolein: "${phrase}"`,
    instructionEnglish: `Please say: "${phrase}"`,
  };
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Fuzzy match score between expected phrase and actual transcript.
 * Returns a normalized score between 0.0 (no match) and 1.0 (exact match).
 */
export function calculateFuzzyMatchScore(expected: string, actual: string): number {
  const normExpected = normalizeText(expected);
  const normActual = normalizeText(actual);

  if (!normExpected || !normActual) return 0;
  if (normExpected === normActual) return 1;

  // 1. Character-level Levenshtein similarity
  const maxLen = Math.max(normExpected.length, normActual.length);
  const dist = levenshteinDistance(normExpected, normActual);
  const charSimilarity = Math.max(0, 1 - dist / maxLen);

  // 2. Token overlap similarity
  const expectedTokens = new Set(normExpected.split(/\s+/));
  const actualTokens = normActual.split(/\s+/);
  let matchedTokens = 0;
  for (const t of actualTokens) {
    if (expectedTokens.has(t)) matchedTokens++;
  }
  const tokenSimilarity =
    matchedTokens / Math.max(expectedTokens.size, actualTokens.length);

  // Weighted combination
  const combined = Math.round((charSimilarity * 0.5 + tokenSimilarity * 0.5) * 100) / 100;
  return combined;
}

export interface VoiceChallengeVerificationResult {
  passed: boolean;
  score: number;
  expectedPhrase: string;
  transcript: string;
  isSecondarySignalOnly: true;
  reason: string;
}

/**
 * Verifies the voice challenge transcript.
 * Note: If verification fails, it adds a risk flag and audit event, but DOES NOT lock the user.
 */
export async function verifyVoiceChallenge(
  db: Database,
  userId: string,
  challengeId: string,
  transcript: string,
  threshold = 0.55
): Promise<VoiceChallengeVerificationResult> {
  const challenge = activeChallenges.get(challengeId);
  const expectedPhrase = challenge ? challenge.phrase : VOICE_CHALLENGE_PHRASES[0];

  const score = calculateFuzzyMatchScore(expectedPhrase, transcript);
  const passed = score >= threshold;

  // Log audit event as a risk signal
  await writeAudit(db, {
    user_id: userId,
    kind: passed ? 'voice_challenge_passed' : 'voice_challenge_failed',
    payload: JSON.stringify({
      challengeId,
      expected: expectedPhrase,
      transcript,
      score,
      threshold,
      isSecondarySignalOnly: true,
    }),
  });

  return {
    passed,
    score,
    expectedPhrase,
    transcript,
    isSecondarySignalOnly: true,
    reason: passed
      ? 'Voice challenge matched expected phrase'
      : 'Voice challenge did not match; recorded as secondary risk signal',
  };
}
