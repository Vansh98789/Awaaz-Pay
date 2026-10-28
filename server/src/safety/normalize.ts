// Normalize input text across English, Devanagari Hindi, and Hinglish transliterations

const HINGLISH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(jldi|jldy)\b/gu, 'jaldi'],
  [/\b(turanth|trunt|turnt)\b/gu, 'turant'],
  [/\b(btao|btana|btaiye)\b/gu, 'batao'],
  [/\b(krna|kro|kariye)\b/gu, 'karna'],
  [/\b(plz|pls)\b/gu, 'please'],
  [/\b(acc|a\/c)\b/gu, 'account'],
];

/**
 * Normalizes speech transcript: lowercases, removes punctuation while preserving
 * Unicode characters (Devanagari and Latin), unifies common phonetic variants,
 * and collapses multiple whitespace characters.
 */
export function normalizeText(text: string): string {
  if (!text) return '';

  let normalized = text.toLowerCase();

  // Strip punctuation and symbols while preserving letters, numbers, and spaces across alphabets
  normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  // Collapse consecutive whitespaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Unify common Hinglish phonetic spelling variations
  for (const [pattern, replacement] of HINGLISH_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}
