import { normalizeText } from './normalize.js';
import { SCAM_CATEGORIES } from './scamPhrases.js';
import type {
  MatchedSignal,
  RiskContextFlags,
  ScamCategory,
  ScamDetectionResult,
  ScamRiskLevel,
} from './types.js';

function buildPhraseRegex(phrase: string): RegExp {
  const normalized = normalizeText(phrase);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s|[^\\p{L}\\p{N}])${escaped}($|\\s|[^\\p{L}\\p{N}])`, 'u');
}

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

  let totalScore = 0;
  for (const def of SCAM_CATEGORIES) {
    if (matchedCategories.has(def.category)) {
      totalScore += def.baseWeight;
    }
  }

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

export function combineRisk(
  signals: ScamDetectionResult,
  contextFlags?: RiskContextFlags
): ScamRiskLevel {
  const flags = contextFlags ?? {};

  if (flags.payeeOnBlocklist) {
    return 'high';
  }

  const hasCriticalCategory = signals.categories.some((cat) =>
    ['threat_authority', 'otp_kyc', 'secrecy', 'prize_lottery'].includes(cat)
  );
  if (hasCriticalCategory || signals.score >= 0.6) {
    return 'high';
  }

  if (flags.toldToPayBySomeone) {
    if (signals.score > 0 || flags.unverifiedPayee || flags.unusuallyHighAmount) {
      return 'high';
    }
    return 'medium';
  }

  if (signals.score >= 0.25) {
    return 'medium';
  }

  if (flags.unverifiedPayee && flags.unusuallyHighAmount) {
    return 'medium';
  }
  if (flags.unverifiedPayee && flags.rapidSequence) {
    return 'medium';
  }

  return 'low';
}
