import { describe, expect, it } from 'vitest';

// WCAG 2.1 Contrast Ratio formula
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function sRgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Design Tokens — WCAG 2.1 AA Contrast Compliance', () => {
  describe('Light Theme Tokens', () => {
    const tokens = {
      bg: '#F8F8F6',
      surface: '#FFFFFF',
      text: '#111111',
      textMuted: '#4A4A4A',
      accent: '#1D4ED8',
      accentText: '#FFFFFF',
      success: '#0F7B3F',
      successText: '#FFFFFF',
      danger: '#B42318',
      dangerText: '#FFFFFF',
      warning: '#8A5A00',
      warningText: '#FFFFFF',
    };

    it('text (#111111) on page bg (#F8F8F6) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.text, tokens.bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('text (#111111) on surface (#FFFFFF) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.text, tokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text (#4A4A4A) on page bg (#F8F8F6) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.textMuted, tokens.bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('accent text on accent button (#1D4ED8) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.accentText, tokens.accent);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('success text on success banner (#0F7B3F) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.successText, tokens.success);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('danger text on danger banner (#B42318) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.dangerText, tokens.danger);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('warning text on warning banner (#8A5A00) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.warningText, tokens.warning);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('Dark Theme Tokens', () => {
    const tokens = {
      bg: '#0E0E0F',
      surface: '#18181A',
      text: '#F4F4F2',
      textMuted: '#B8B8B4',
      accent: '#8AAEFF',
      accentText: '#0E0E0F',
      success: '#5FD08A',
      successText: '#0E0E0F',
      danger: '#FF8F85',
      dangerText: '#0E0E0F',
      warning: '#F2C063',
      warningText: '#0E0E0F',
    };

    it('text (#F4F4F2) on page bg (#0E0E0F) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.text, tokens.bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('text (#F4F4F2) on surface (#18181A) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.text, tokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text (#B8B8B4) on page bg (#0E0E0F) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.textMuted, tokens.bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('accent text on accent button (#8AAEFF) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.accentText, tokens.accent);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('success text on success banner (#5FD08A) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.successText, tokens.success);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('danger text on danger banner (#FF8F85) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.dangerText, tokens.danger);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('warning text on warning banner (#F2C063) achieves >= 4.5:1 contrast', () => {
      const ratio = contrastRatio(tokens.warningText, tokens.warning);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });
});
