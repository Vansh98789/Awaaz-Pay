import React, { useEffect, useRef } from 'react';
import {
  Page,
  DotWordmark,
  Headline,
  BodyText,
  BigButton,
  StatusBanner,
  BrailleCells,
} from '../design/index.js';
import { triggerHaptic } from '../hooks/useHaptics.js';

interface ConfirmPaymentProps {
  payeeName: string;
  amount: number;
  currency?: string;
  contextSentence?: string; // e.g. "To Ravi Cabs, a verified merchant."
  warningText?: string;     // e.g. "New payee. Limit 500 rupaye."
  isBlocked?: boolean;
  blockedReason?: string;
  isProcessing?: boolean;
  isSuccess?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  speak: (text: string) => void;
  lang?: 'hi-IN' | 'en-IN';
}

export const ConfirmPaymentScreen: React.FC<ConfirmPaymentProps> = ({
  payeeName,
  amount,
  currency = 'rupaye',
  contextSentence = 'To a trusted contact.',
  warningText,
  isBlocked = false,
  blockedReason,
  isProcessing = false,
  isSuccess = false,
  onConfirm,
  onCancel,
  speak,
  lang = 'hi-IN',
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const announcedRef = useRef(false);

  // Announce automatically on mount: payee, amount, then "Shall I pay?"
  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;

    if (isBlocked) {
      triggerHaptic('blocked');
      const msg =
        lang === 'hi-IN'
          ? `Rukiye, ${payeeName} ko payment rok diya gaya hai. ${blockedReason || 'Scam sandeh ke kaaran.'}`
          : `Blocked. Payment to ${payeeName} has been stopped. ${blockedReason || 'High risk detected.'}`;
      speak(msg);
      return;
    }

    triggerHaptic('understood');
    const spokenAmount = `${amount} ${currency}`;
    const announcement =
      lang === 'hi-IN'
        ? `${payeeName}, ${spokenAmount}. ${contextSentence} Kya main payment bhej doon?`
        : `${payeeName}, ${spokenAmount}. ${contextSentence} Shall I pay?`;
    speak(announcement);

    // Cancel is easy to reach; Yes is never default focus
    cancelBtnRef.current?.focus();
  }, [payeeName, amount, currency, contextSentence, isBlocked, blockedReason, lang, speak]);

  if (isSuccess) {
    return (
      <Page
        headerContent={<DotWordmark size={140} />}
        footerContent={
          <BigButton variant="primary" onClick={onCancel}>
            {lang === 'hi-IN' ? 'Theek hai (Done)' : 'Done'}
          </BigButton>
        }
      >
        <StatusBanner variant="success" label="Safal">
          {lang === 'hi-IN'
            ? `${payeeName} ko ${amount} rupaye bhej diye gaye hain.`
            : `Payment of ₹${amount} to ${payeeName} completed successfully.`}
        </StatusBanner>
        <BrailleCells totalCells={4} activeCells={4} label="Payment completed" />
      </Page>
    );
  }

  if (isBlocked) {
    return (
      <Page
        headerContent={<DotWordmark size={140} />}
        footerContent={
          <BigButton variant="secondary" onClick={onCancel} ref={cancelBtnRef}>
            {lang === 'hi-IN' ? 'Wapas jayein (Back)' : 'Go Back'}
          </BigButton>
        }
      >
        <StatusBanner variant="danger" label="Blocked">
          {blockedReason || 'Payment was blocked due to high security or scam risk.'}
        </StatusBanner>
        <BodyText size="large">
          {lang === 'hi-IN'
            ? 'Aapke paise surakshit hain. Koi katauti nahi hui.'
            : 'Your money is safe. No money was deducted.'}
        </BodyText>
      </Page>
    );
  }

  return (
    <Page
      headerContent={
        <>
          <DotWordmark size={140} />
          <Headline level={1}>{payeeName}</Headline>
          <BodyText muted>{contextSentence}</BodyText>
        </>
      }
      footerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          {/* Yes is never default focus; Cancel button has initial focus */}
          <BigButton
            variant="primary"
            onClick={onConfirm}
            loading={isProcessing}
            loadingText={lang === 'hi-IN' ? 'Payment ho raha hai...' : 'Processing payment...'}
          >
            {lang === 'hi-IN' ? `Haan, ${amount} rupaye bhej do` : `Yes, pay ₹${amount}`}
          </BigButton>

          <BigButton
            variant="secondary"
            onClick={onCancel}
            ref={cancelBtnRef}
            disabled={isProcessing}
          >
            {lang === 'hi-IN' ? 'Nahi, cancel karo' : 'No, cancel'}
          </BigButton>
        </div>
      }
    >
      {/* Huge Amount Display (4.5rem to 6rem) */}
      <div
        className="amount-huge-display"
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-amount, 4.5rem)',
          fontWeight: 700,
          lineHeight: 1,
          color: 'var(--text)',
          textAlign: 'center',
          margin: '1rem 0',
        }}
        aria-label={`${amount} ${currency}`}
      >
        ₹{amount}
      </div>

      {warningText && (
        <StatusBanner variant="warning" label="Alert">
          {warningText}
        </StatusBanner>
      )}

      {isProcessing && (
        <BrailleCells
          totalCells={4}
          activeCells={2}
          label="Payment processing, please hold steady"
        />
      )}

      <BodyText size="large" muted>
        {lang === 'hi-IN'
          ? 'Bolein "Haan" ya button dabayein.'
          : 'Say "Yes" or tap the button to confirm.'}
      </BodyText>
    </Page>
  );
};
