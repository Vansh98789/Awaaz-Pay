import { normalizeText } from './normalize.js';
import { SCAM_CATEGORIES } from './scamPhrases.js';
import type {
  MatchedSignal,
  RiskContextFlags,
  ScamCategory,
  ScamDetectionResult,
  ScamRiskLevel,
} from './types.js';

// Construct regex pattern matching a phrase with boundary protection
function buildPhraseRegex(phrase: string): RegExp {
  const normalized = normalizeText(phrase);
  // Boundary check supporting both ASCII and Unicode word edges
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s|[^\\p{L}\\p{N}])${escaped}($|\\s|[^\\p{L}\\p{N}])`, 'u');
}

/**
 * Pure rule-based scam signal detector analyzing user transcript for coercion,
 * urgency, threats, and fraudulent payment patterns.
 */
export function detectScamSignals(text: string): ScamDetectionResult {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { score: 0, categories: [], matches: [] };
  }

  const matches: MatchedSignal[] = [];
  const matchedCategories = new Set<ScamCategory>();
  let hasCriticalCategory = false;

  for (const def of SCAM_CATEGORIES) {
    let categoryMatched = false;

    for (const phrase of def.phrases) {
      const regex = buildPhraseRegex(phrase);
      if (regex.test(normalized)) {
        categoryMatched = true;
        matches.push({
          category: def.category,
          phrase,
          weight: def.baseWeight,
        });
      }
    }

    if (categoryMatched) {
      matchedCategories.add(def.category);
      if (def.isCritical) {
        hasCriticalCategory = true;
      }
    }
  }

  // Calculate score summing distinct matched category base weights
  let totalScore = 0;
  for (const def of SCAM_CATEGORIES) {
    if (matchedCategories.has(def.category)) {
      totalScore += def.baseWeight;
    }
  }

  // Critical indicators (police threat, OTP request, secrecy, lottery) guarantee high score
  if (hasCriticalCategory && totalScore < 0.6) {
    totalScore = 0.6;
  }

  const finalScore = Math.min(1, Math.round(totalScore * 100) / 100);

  return {
    score: finalScore,
    categories: Array.from(matchedCategories),
    matches,
  };
}

/**
 * Combines lexical speech signals with contextual metadata (blocklists, amounts,
 * payee verification, and user interview responses) into an actionable risk level.
 */
export function combineRisk(
  signals: ScamDetectionResult,
  contextFlags?: RiskContextFlags
): ScamRiskLevel {
  const flags = contextFlags ?? {};

  // 1. Hard invariant: blocklisted payee is always high risk
  if (flags.payeeOnBlocklist) {
    return 'high';
  }

  // 2. High severity: critical scam categories or strong composite score
  const hasCriticalCategory = signals.categories.some((cat) =>
    ['threat_authority', 'otp_kyc', 'secrecy', 'prize_lottery'].includes(cat)
  );
  if (hasCriticalCategory || signals.score >= 0.6) {
    return 'high';
  }

  // 3. User reported being instructed to pay by a caller
  if (flags.toldToPayBySomeone) {
    // If accompanied by any scam words or an unverified payee, escalate to high
    if (signals.score > 0 || flags.unverifiedPayee || flags.unusuallyHighAmount) {
      return 'high';
    }
    // Acknowledging third-party instruction alone warrants medium risk interview
    return 'medium';
  }

  // 4. Moderate lexical signals (e.g. single urgency or fee claim)
  if (signals.score >= 0.25) {
    return 'medium';
  }

  // 5. Environmental risk combinations
  if (flags.unverifiedPayee && flags.unusuallyHighAmount) {
    return 'medium';
  }
  if (flags.unverifiedPayee && flags.rapidSequence) {
    return 'medium';
  }

  return 'low';
}
