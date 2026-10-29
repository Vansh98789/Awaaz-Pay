import React, { useState } from 'react';
import {
  DotWordmark,
  DotRing,
  BrailleCells,
  BigButton,
  Headline,
  BodyText,
  StatusBanner,
  Page,
  type DotRingState,
} from '../design/index.js';

export const DesignPreviewPage: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [ringState, setRingState] = useState<DotRingState>('listening');
  const [step, setStep] = useState(2);
  const [isLoading, setIsLoading] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <div data-theme={theme} style={{ minHeight: '100vh', width: '100%', backgroundColor: 'var(--bg)' }}>
      <Page
        headerContent={
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <DotWordmark size={150} />
              <button
                type="button"
                onClick={toggleTheme}
                style={{
                  minHeight: '48px',
                  padding: '0.5rem 1rem',
                  borderRadius: 'var(--radius-pill)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                aria-label={`Toggle Theme. Current is ${theme}`}
              >
                {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
              </button>
            </div>
            <Headline level={1}>Design System Preview</Headline>
            <BodyText muted>Blind-first braille dot identity & high contrast tokens</BodyText>
          </>
        }
      >
        {/* 1. DotWordmark */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
          <Headline level={2}>1. Dot Wordmark</Headline>
          <DotWordmark size={200} />
        </section>

        {/* 2. DotRing with interactive state selector */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
          <Headline level={2}>2. Dot Ring ({ringState})</Headline>
          <DotRing state={ringState} radius={110}>
            <button
              type="button"
              style={{
                width: '180px',
                height: '180px',
                borderRadius: '50%',
                backgroundColor: 'var(--surface)',
                border: '4px solid var(--border)',
                color: 'var(--text)',
                fontSize: '1.5rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
              aria-label={`Center action button in state ${ringState}`}
            >
              <span>🎙️</span>
              <span>Mic</span>
            </button>
          </DotRing>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {(['idle', 'listening', 'speaking', 'success', 'blocked'] as DotRingState[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRingState(s)}
                style={{
                  minHeight: '48px',
                  padding: '0.5rem 1rem',
                  borderRadius: 'var(--radius-pill)',
                  backgroundColor: ringState === s ? 'var(--accent)' : 'var(--surface)',
                  color: ringState === s ? 'var(--accent-text)' : 'var(--text)',
                  border: '2px solid var(--border)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {/* 3. BrailleCells Progress Row */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
          <Headline level={2}>3. Braille Cells Progress</Headline>
          <BrailleCells totalCells={4} activeCells={step} label={`Step ${step} of 4`} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStep(n)}
                style={{
                  minHeight: '48px',
                  padding: '0.5rem 1rem',
                  borderRadius: 'var(--radius-pill)',
                  backgroundColor: step === n ? 'var(--accent)' : 'var(--surface)',
                  color: step === n ? 'var(--accent-text)' : 'var(--text)',
                  border: '2px solid var(--border)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Step {n}
              </button>
            ))}
          </div>
        </section>

        {/* 4. Big Buttons */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Headline level={2}>4. Big Buttons (64px target)</Headline>
          <BigButton variant="primary">Primary: Yes, pay ₹250</BigButton>
          <BigButton variant="secondary">Secondary: No, cancel</BigButton>
          <BigButton variant="danger">Danger: Block transaction</BigButton>
          <BigButton
            variant="primary"
            loading={isLoading}
            loadingText="Processing payment..."
            onClick={() => {
              setIsLoading(true);
              setTimeout(() => setIsLoading(false), 2000);
            }}
          >
            {isLoading ? 'Processing' : 'Click to test loading state'}
          </BigButton>
        </section>

        {/* 5. Typography & Amount Display */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
          <Headline level={2}>5. Typography</Headline>
          <div
            style={{
              fontSize: 'var(--text-amount, 4.5rem)',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              lineHeight: 1,
              color: 'var(--text)',
            }}
          >
            ₹250
          </div>
          <BodyText size="large">Large body: Ramesh ji ko ₹250 bhejne hain.</BodyText>
          <BodyText size="standard" muted>Muted standard body: Aapka dainik kharcha 1,000 rupaye tak seemit hai.</BodyText>
          <BodyText size="standard" lang="hi">
            हिंदी भाषा: बोलकर पैसे भेजें और खाते का बैलेंस जानें।
          </BodyText>
        </section>

        {/* 6. Status Banners */}
        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Headline level={2}>6. Status Banners</Headline>
          <StatusBanner variant="success" label="Safal">
            Payment safal raha! Ravi Cabs ko 250 rupaye bhej diye gaye.
          </StatusBanner>
          <StatusBanner variant="warning" label="Warning">
            New payee. Limit 500 rupaye for cooling-off period.
          </StatusBanner>
          <StatusBanner variant="danger" label="Blocked">
            Scam alert: Call impersonation detected. Payment was stopped safely.
          </StatusBanner>
        </section>
      </Page>
    </div>
  );
};
