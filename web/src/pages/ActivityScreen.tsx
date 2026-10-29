import React, { useState, useEffect } from 'react';
import {
  Page,
  DotWordmark,
  Headline,
  BodyText,
  BigButton,
  StatusBanner,
} from '../design/index.js';

interface ActivityItem {
  id: string;
  sentence: string;
  direction: 'IN' | 'OUT';
  amount: number;
  time: string;
  status: string;
  source: string;
  reference?: string;
  paypalStatus?: string;
}

interface ActivityScreenProps {
  onBack: () => void;
  speak: (text: string) => void;
  lang?: 'hi-IN' | 'en-IN';
}

export const ActivityScreen: React.FC<ActivityScreenProps> = ({
  onBack,
  speak,
  lang = 'hi-IN',
}) => {
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    async function loadActivity() {
      try {
        setLoading(true);
        const res = await fetch('/api/family/dashboard');
        if (res.ok) {
          const data = await res.json();
          const mapped: ActivityItem[] = (data.transactions || []).map((a: any) => {
            const isReceived = a.direction === 'IN';
            const status = String(a.status || 'unknown').replace(/_/g, ' ');
            const isSyntheticRef = String(a.paypalRef || '').startsWith('sandbox-payout-')
              || String(a.paypalRef || '').startsWith('batch-');
            const sentence = isReceived
              ? lang === 'hi-IN'
                ? `${a.counterparty} se ${a.amount} rupaye mile, ${a.time}.`
                : `Received ${a.amount} rupees from ${a.counterparty}, ${a.time}.`
              : lang === 'hi-IN'
                ? `${a.counterparty} ko ${a.amount} rupaye bheje, ${a.time}.`
                : `Sent ${a.amount} rupees to ${a.counterparty}, ${a.time}.`;

            return {
              id: a.id,
              sentence,
              direction: a.direction,
              amount: a.amount,
              time: a.time,
              status,
              source: isSyntheticRef
                ? 'Awaaz Pay simulated fallback · no PayPal transfer'
                : a.paypalRef ? 'PayPal Sandbox test record' : 'Awaaz Pay wallet ledger',
              reference: a.paypalRef || undefined,
              paypalStatus: a.paypalStatus,
            };
          });
          setItems(mapped);
          setLoadError(false);
        } else {
          setItems([]);
          setLoadError(true);
        }
      } catch {
        setItems([]);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }
    loadActivity();
  }, [lang]);

  const filteredItems = items.filter((item) => {
    if (filter === 'in') return item.direction === 'IN';
    if (filter === 'out') return item.direction === 'OUT';
    return true;
  });

  const handleReadSummary = () => {
    if (loadError) {
      speak(lang === 'hi-IN'
        ? 'Asli transaction list load nahi hui. Koi demo hisab nahi padhkar sunaya ja raha.'
        : 'The live transaction list did not load. No sample activity will be read as real.');
      return;
    }
    if (filteredItems.length === 0) {
      const msg =
        lang === 'hi-IN'
          ? 'Koi len-den nahi mila.'
          : 'No transactions found.';
      speak(msg);
      return;
    }

    const sentences = filteredItems.map((item) => item.sentence).join(' ');
    speak(sentences);
  };

  return (
    <Page
      headerContent={
        <>
          <DotWordmark size={140} />
          <Headline level={1}>{lang === 'hi-IN' ? 'Pichla Hisab' : 'Recent Activity'}</Headline>
        </>
      }
      footerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          <BigButton variant="primary" onClick={handleReadSummary}>
            🔊 {lang === 'hi-IN' ? 'Mujhe padhkar sunao' : 'Read it to me'}
          </BigButton>
          <BigButton variant="secondary" onClick={onBack}>
            {lang === 'hi-IN' ? 'Wapas Home' : 'Back to Home'}
          </BigButton>
        </div>
      }
    >
      <StatusBanner variant="warning" label="Sandbox test mode">
        {lang === 'hi-IN'
          ? 'Yeh PayPal ke test records hain. Is app se asli paise nahi bheje jaate.'
          : 'These are PayPal sandbox test records. This app does not move real money.'}
      </StatusBanner>
      {loadError && (
        <StatusBanner variant="danger" label={lang === 'hi-IN' ? 'Hisab load nahi hua' : 'Live activity unavailable'}>
          {lang === 'hi-IN'
            ? 'Server se asli transaction list nahi mili. Koi demo transaction nahi dikhaya ja raha.'
            : 'The server activity list could not be loaded. No sample transactions are being shown.'}
        </StatusBanner>
      )}
      {/* 3 Large Filter Buttons */}
      <div
        role="group"
        aria-label="Filter activity items"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem',
          width: '100%',
        }}
      >
        <button
          type="button"
          onClick={() => setFilter('all')}
          style={{
            minHeight: 'var(--min-target, 64px)',
            borderRadius: 'var(--radius-pill)',
            backgroundColor: filter === 'all' ? 'var(--accent)' : 'var(--surface)',
            color: filter === 'all' ? 'var(--accent-text)' : 'var(--text)',
            border: '2px solid var(--border)',
            fontSize: 'var(--text-body, 1.25rem)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-pressed={filter === 'all'}
        >
          {lang === 'hi-IN' ? 'Sabhi' : 'All'}
        </button>

        <button
          type="button"
          onClick={() => setFilter('in')}
          style={{
            minHeight: 'var(--min-target, 64px)',
            borderRadius: 'var(--radius-pill)',
            backgroundColor: filter === 'in' ? 'var(--accent)' : 'var(--surface)',
            color: filter === 'in' ? 'var(--accent-text)' : 'var(--text)',
            border: '2px solid var(--border)',
            fontSize: 'var(--text-body, 1.25rem)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-pressed={filter === 'in'}
        >
          {lang === 'hi-IN' ? 'Mile' : 'Received'}
        </button>

        <button
          type="button"
          onClick={() => setFilter('out')}
          style={{
            minHeight: 'var(--min-target, 64px)',
            borderRadius: 'var(--radius-pill)',
            backgroundColor: filter === 'out' ? 'var(--accent)' : 'var(--surface)',
            color: filter === 'out' ? 'var(--accent-text)' : 'var(--text)',
            border: '2px solid var(--border)',
            fontSize: 'var(--text-body, 1.25rem)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-pressed={filter === 'out'}
        >
          {lang === 'hi-IN' ? 'Bheje' : 'Sent'}
        </button>
      </div>

      {/* Semantic List of Transactions */}
      {loading ? (
        <BodyText size="large" muted>
          {lang === 'hi-IN' ? 'Hisab load ho raha hai...' : 'Loading recent activity...'}
        </BodyText>
      ) : loadError ? (
        <BodyText size="large" muted>
          {lang === 'hi-IN' ? 'Dobara koshish karne ke liye home par jaakar hisab kholiye.' : 'Return to Home and reopen activity to try again.'}
        </BodyText>
      ) : filteredItems.length === 0 ? (
        <BodyText size="large" muted>
          {lang === 'hi-IN' ? 'Is category mein koi len-den nahi hai.' : 'No items in this category.'}
        </BodyText>
      ) : (
        <ul
          aria-label="List of transactions"
          style={{
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            width: '100%',
          }}
        >
          {filteredItems.map((item) => (
            <li
              key={item.id}
              style={{
                minHeight: 'var(--min-target, 64px)',
                padding: '1.25rem 1.5rem',
                backgroundColor: 'var(--surface)',
                border: '2px solid var(--border)',
                borderRadius: 'var(--radius-card, 16px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <BodyText size="large">{item.sentence}</BodyText>
                <BodyText muted>{item.status} · {item.source}</BodyText>
                {item.paypalStatus && <BodyText muted>PayPal reports: {item.paypalStatus}</BodyText>}
                {item.reference && <BodyText muted>ID {item.reference}</BodyText>}
              </div>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 'var(--text-body-large, 1.5rem)',
                  color: item.direction === 'IN' ? 'var(--success)' : 'var(--text)',
                  whiteSpace: 'nowrap',
                }}
                aria-hidden="true"
              >
                {item.direction === 'IN' ? `+₹${item.amount}` : `-₹${item.amount}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
};
