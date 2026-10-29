/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Accessibility & Blind-First Design Spec Audit', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      writable: true,
      value: {
        speak: vi.fn(),
        cancel: vi.fn(),
        getVoices: vi.fn().mockReturnValue([]),
        onvoiceschanged: null,
      },
    });

    globalThis.SpeechSynthesisUtterance = vi.fn().mockImplementation((text?: string) => ({
      text: text || '',
      lang: 'hi-IN',
      rate: 1.0,
      pitch: 1.0,
      voice: null,
      onstart: null,
      onend: null,
      onerror: null,
    })) as unknown as typeof SpeechSynthesisUtterance;
  });

  it('Page layout component enforces skip-link and main-content landmark', () => {
    const pageSource = fs.readFileSync(
      path.resolve(__dirname, '../src/design/Page.tsx'),
      'utf8'
    );

    expect(pageSource).toContain('skip-link');
    expect(pageSource).toContain('#main-content');
    expect(pageSource).toContain('role="main"');
    expect(pageSource).toContain('role="banner"');
  });

  it('DotWordmark component has role="img" and accessible aria-label="Awaaz Pay"', () => {
    const wordmarkSource = fs.readFileSync(
      path.resolve(__dirname, '../src/design/DotWordmark.tsx'),
      'utf8'
    );

    expect(wordmarkSource).toContain('role="img"');
    expect(wordmarkSource).toContain('aria-label="Awaaz Pay"');
  });

  it('BrailleCells component has role="progressbar" and accessible value attributes', () => {
    const brailleSource = fs.readFileSync(
      path.resolve(__dirname, '../src/design/BrailleCells.tsx'),
      'utf8'
    );

    expect(brailleSource).toContain('role="progressbar"');
    expect(brailleSource).toContain('aria-valuenow');
    expect(brailleSource).toContain('aria-valuemax');
    expect(brailleSource).toContain('aria-label');
  });

  it('BigButton component enforces accessible text labels and aria-busy when loading', () => {
    const buttonSource = fs.readFileSync(
      path.resolve(__dirname, '../src/design/BigButton.tsx'),
      'utf8'
    );

    expect(buttonSource).toContain('aria-busy');
    expect(buttonSource).toContain('big-button');
    expect(buttonSource).toContain('loadingText');
  });

  it('StatusBanner pairs color with explicit word labels and proper alert/status roles', () => {
    const bannerSource = fs.readFileSync(
      path.resolve(__dirname, '../src/design/StatusBanner.tsx'),
      'utf8'
    );

    expect(bannerSource).toContain("variant === 'danger' ? 'alert' : 'status'");
    expect(bannerSource).toContain('banner-word-label');
    expect(bannerSource).toContain('aria-live');
  });

  it('App home screen provides status live region, transcript, and dual output modes', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    expect(appSource).toContain('role="status"');
    expect(appSource).toContain('aria-live="polite"');
    expect(appSource).toContain('outputMode');
    expect(appSource).toContain('Screen Reader');
    expect(appSource).toContain('aria-label="Conversation transcript"');
  });

  it('Guardian approve page provides explicit approve and deny actions', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/pages/GuardianApprovePage.tsx'),
      'utf8'
    );

    expect(source).toContain('Approve');
    expect(source).toContain('Deny');
    expect(source).toContain('BigButton');
  });

  it('Family dashboard page includes dot markers and accessible column headers', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/pages/FamilyDashboardPage.tsx'),
      'utf8'
    );

    expect(source).toContain('customGridTheme');
    expect(source).toContain('headerName');
    expect(source).toContain('Time');
    expect(source).toContain('Direction');
    expect(source).toContain('Counterparty');
    expect(source).toContain('Amount');
    expect(source).toContain('Risk');
    expect(source).toContain('Status');
    // Dot markers for visual parity
    expect(source).toContain('● ● ●');
  });
});
