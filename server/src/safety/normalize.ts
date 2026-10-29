const HINGLISH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(jldi|jldy)\b/gu, 'jaldi'],
  [/\b(turanth|trunt|turnt)\b/gu, 'turant'],
  [/\b(btao|btana|btaiye)\b/gu, 'batao'],
  [/\b(krna|kro|kariye)\b/gu, 'karna'],
  [/\b(plz|pls)\b/gu, 'please'],
  [/\b(acc|a\/c)\b/gu, 'account'],
];

export function normalizeText(text: string): string {
  if (!text) return '';

  let normalized = text.toLowerCase();
  normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  for (const [pattern, replacement] of HINGLISH_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}
