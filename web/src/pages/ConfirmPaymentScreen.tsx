import React, { useEffect, useRef } from 'react';
import {
  Page,
  DotWordmark,
  Headline,
  BodyText,
  BigButton,
  StatusBanner,
  BrailleCells,
  DotRing,
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
  isPending?: boolean;
  isApprovalPending?: boolean;
  isFailed?: boolean;
  statusMessage?: string;
  transactionId?: string;
  paypalBatchId?: string;
  onConfirm: () => void;
  onCancel: () => void;
  speak: (text: string) => void;
  lang?: 'hi-IN' | 'en-IN';
  isListening?: boolean;
  onToggleMic?: () => void;
}

export const ConfirmPaymentScreen: React.FC<ConfirmPaymentProps> = ({
  payeeName,
  amount,
  currency = 'rupees',
  contextSentence = 'To a trusted contact.',
  warningText,
  isBlocked = false,
  blockedReason,
  isProcessing = false,
  isSuccess = false,
  isPending = false,
  isApprovalPending = false,
  isFailed = false,
  statusMessage,
  transactionId,
  paypalBatchId,
  onConfirm,
  onCancel,
  speak,
  lang = 'en-IN',
  isListening = false,
  onToggleMic,
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
          : `Blocked. Payment to ${payeeName} was stopped. ${blockedReason || 'High risk detected.'}`;
      speak(msg);
      return;
    }

    triggerHaptic('understood');
    const spokenAmount = `${amount} ${currency}`;
    const announcement =
      lang === 'hi-IN'
        ? `${payeeName}, ${spokenAmount}. ${contextSentence} Kya main payment bhej doon? Haan ya nahi bolein.`
        : `${payeeName}, ${spokenAmount}. ${contextSentence} Shall I pay? Say yes to confirm or no to cancel.`;
    speak(announcement);

    // Cancel is easy to reach; Yes is never default focus
    cancelBtnRef.current?.focus();
  }, [payeeName, amount, currency, contextSentence, isBlocked, blockedReason, lang, speak]);

  if (isSuccess) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const receiptText =
      lang === 'hi-IN'
        ? `PayPal Sandbox test payment safal raha. ${amount} rupaye ${payeeName} ko bhej diye gaye. Asli paise nahi bheje gaye.`
        : `PayPal Sandbox test payment completed. Sent ₹${amount} to ${payeeName}. No real money was moved.`;

    return (
      <Page
        headerContent={
          <>
            <DotWordmark size={140} />
            <Headline level={1}>{lang === 'hi-IN' ? 'पेमेंट सफल' : 'Payment Sent'}</Headline>
          </>
        }
        footerContent={
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
            <BigButton variant="primary" onClick={onCancel}>
              {lang === 'hi-IN' ? 'Theek hai (Done)' : 'Done'}
            </BigButton>
            <BigButton
              variant="secondary"
              onClick={() => speak(receiptText)}
              aria-label="Read receipt out loud"
            >
              🔊 {lang === 'hi-IN' ? 'रसीद सुनें (Read Receipt)' : 'Read Receipt'}
            </BigButton>
          </div>
        }
      >
        <StatusBanner variant="success" label="PayPal Sandbox test completed">
          {receiptText}
        </StatusBanner>

        {/* Visual Receipt Card */}
        <section
          style={{
            width: '100%',
            padding: '1.5rem',
            backgroundColor: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius-card, 16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
          aria-label="Payment receipt"
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 'var(--text-amount, 3.5rem)',
                fontWeight: 700,
                color: 'var(--success, #0F7B3F)',
                lineHeight: 1,
              }}
            >
              ₹{amount}
            </div>
            <BodyText muted size="large">
              {lang === 'hi-IN' ? `${payeeName} को भेजा गया` : `Sent to ${payeeName}`}
            </BodyText>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>{lang === 'hi-IN' ? 'समय' : 'Time'}</span>
            <span style={{ fontWeight: 700 }}>Today, {timeStr}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>{lang === 'hi-IN' ? 'स्थिति' : 'Status'}</span>
            <span style={{ color: 'var(--success, #0F7B3F)', fontWeight: 700 }}>Completed in Sandbox</span>
          </div>

          {paypalBatchId && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>PayPal payout batch</span>
              <span style={{ fontFamily: 'monospace' }}>{paypalBatchId}</span>
            </div>
          )}

          {transactionId && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>ID</span>
              <span style={{ fontFamily: 'monospace' }}>{transactionId.slice(0, 14)}</span>
            </div>
          )}
        </section>

        <BrailleCells totalCells={4} activeCells={4} label="Payment completed" />
      </Page>
    );
  }

  if (isPending) {
    return (
      <Page
        headerContent={<><DotWordmark size={140} /><Headline level={1}>{isApprovalPending ? 'Guardian approval required' : 'Payment not confirmed yet'}</Headline></>}
        footerContent={<BigButton variant="secondary" onClick={onCancel}>Done</BigButton>}
      >
        <StatusBanner variant="warning" label={isApprovalPending ? 'No payout sent yet' : 'PayPal Sandbox status pending'}>
          {statusMessage || (isApprovalPending
            ? 'Wait for guardian approval before this payment is sent.'
            : 'PayPal has not confirmed completion yet. Do not retry this payment.')}
        </StatusBanner>
        <BodyText size="large">This is a sandbox test. No real money is moved.</BodyText>
        {paypalBatchId && <BodyText muted>PayPal payout batch: {paypalBatchId}</BodyText>}
        {transactionId && <BodyText muted>Transaction ID: {transactionId}</BodyText>}
      </Page>
    );
  }

  if (isFailed) {
    return (
      <Page
        headerContent={<><DotWordmark size={140} /><Headline level={1}>Payment failed</Headline></>}
        footerContent={<BigButton variant="secondary" onClick={onCancel}>Done</BigButton>}
      >
        <StatusBanner variant="danger" label="No successful PayPal transfer">
          {statusMessage || 'PayPal did not confirm this payment. Any reserved wallet amount was returned.'}
        </StatusBanner>
        <BodyText size="large">This is a sandbox test. No real money was moved.</BodyText>
        {transactionId && <BodyText muted>Transaction ID: {transactionId}</BodyText>}
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
      <StatusBanner variant="warning" label={lang === 'hi-IN' ? 'Sandbox test mode' : 'Sandbox test mode'}>
        {lang === 'hi-IN'
          ? 'Yeh PayPal ka test payment hai. Isse asli paise nahi bheje jaate.'
          : 'This is a PayPal sandbox test payment. No real money will be moved.'}
      </StatusBanner>
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

      {/* Voice Status Indicator for Hands-Free response */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem',
          margin: '0.5rem 0',
        }}
      >
        <DotRing state={isListening ? 'listening' : 'idle'} radius={50}>
          <button
            type="button"
            onClick={onToggleMic}
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: isListening ? 'var(--accent)' : 'var(--surface)',
              color: isListening ? 'var(--accent-text)' : 'var(--text)',
              border: '3px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label={isListening ? 'Listening for your confirmation' : 'Tap to speak confirmation'}
          >
            <span style={{ fontSize: '1.75rem' }}>🎙️</span>
          </button>
        </DotRing>

        <div
          role="status"
          aria-live="polite"
          style={{
            fontSize: 'var(--text-body-large)',
            fontWeight: 700,
            color: isListening ? 'var(--accent)' : 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          {isListening
            ? lang === 'hi-IN'
              ? 'सुन रही हूँ: "हाँ" या "नहीं" बोलें'
              : 'Listening: say "Yes" or "No"'
            : lang === 'hi-IN'
              ? 'माइक दबाकर बोलें या नीचे बटन चुनें'
              : 'Tap mic or say "Yes" / "No"'}
        </div>
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
    </Page>
  );
};
