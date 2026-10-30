import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Page,
  DotWordmark,
  Headline,
  BodyText,
  StatusBanner,
} from '../design/index.js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis.js';
import { triggerHaptic } from '../hooks/useHaptics.js';

interface ActivityItem {
  id: string;
  direction: 'IN' | 'OUT';
  counterparty: string;
  amount: number;
  time: string;
  status: string;
  source: string;
  reference?: string;
  paypalStatus?: string;
}

interface ActivityScreenProps {
  lang?: 'hi-IN' | 'en-IN';
  autoStartVoice?: boolean;
  initialVoiceRequest?: string | null;
  onInitialVoiceRequestHandled?: () => void;
  onGoHome?: () => void;
  onNavigate?: (destination: 'wallet' | 'activity' | 'family' | 'settings' | 'scanner' | 'merchant') => void;
  onSetPreference?: (preference: string, value: string) => void;
  onDelegateConversation?: (text: string) => void;
}

type ActivityFilter = 'all' | 'sent' | 'received';

function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[.,!?;:।]/g, ' ').replace(/\s+/g, ' ').trim();
}

function closeRecipientMatch(left: string, right: string): boolean {
  const a = left.replace(/\s/g, '');
  const b = right.replace(/\s/g, '');
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] <= 1;
}

function spokenDate(value: string, lang: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
}

export const ActivityScreen: React.FC<ActivityScreenProps> = ({ lang = 'en-IN', autoStartVoice = false, initialVoiceRequest = null, onInitialVoiceRequestHandled, onGoHome, onNavigate, onSetPreference, onDelegateConversation }) => {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [paypalBalance, setPaypalBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceActiveRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef = useRef<() => void>(() => {});
  const repeatLastReplyRef = useRef<() => void>(() => {});
  const goHomeAfterSpeechRef = useRef(false);
  const navigateAfterSpeechRef = useRef<(() => void) | null>(null);
  const initialRequestHandledRef = useRef(false);
  const [lastHeard, setLastHeard] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const filteredItems = activityFilter === 'all'
    ? items
    : items.filter((item) => item.direction === (activityFilter === 'sent' ? 'OUT' : 'IN'));

  const { speak, repeatLastReply, isSpeaking } = useSpeechSynthesis({
    defaultLang: lang,
    onEnd: () => {
      if (goHomeAfterSpeechRef.current) {
        goHomeAfterSpeechRef.current = false;
        onGoHome?.();
        return;
      }
      if (navigateAfterSpeechRef.current) {
        const navigate = navigateAfterSpeechRef.current;
        navigateAfterSpeechRef.current = null;
        navigate();
        return;
      }
      if (voiceActiveRef.current) window.setTimeout(() => startListeningRef.current(), 350);
    },
  });
  repeatLastReplyRef.current = repeatLastReply;

  const say = useCallback((text: string) => {
    setAssistantReply(text);
    speak(text, { lang });
  }, [lang, speak]);

  const loadActivity = useCallback(async (announce = false) => {
    try {
      setLoading(true);
      const response = await fetch('/api/family/wallet-activity');
      if (!response.ok) throw new Error('Activity could not be loaded.');
      const data = await response.json();
      const mapped: ActivityItem[] = (data.transactions || []).map((tx: any) => {
        const paypalRef = String(tx.paypalRef || '');
        const synthetic = paypalRef.startsWith('sandbox-payout-') || paypalRef.startsWith('batch-');
        return {
          id: tx.id,
          direction: tx.direction === 'IN' ? 'IN' : 'OUT',
          counterparty: tx.counterparty || 'Unknown recipient',
          amount: Number(tx.amount) || 0,
          time: tx.time,
          status: String(tx.status || 'unknown').replace(/_/g, ' '),
          source: synthetic ? 'Awaaz Pay fallback · no PayPal transfer' : paypalRef ? 'PayPal Sandbox record' : 'Awaaz Pay activity record',
          reference: paypalRef || undefined,
          paypalStatus: tx.paypalStatus,
        };
      });
      setItems(mapped);
      setLoadError(false);
      setSelectedIndex(0);
      if (announce) say(lang === 'hi-IN' ? 'Hisaab refresh ho gaya.' : 'Recent activity has been refreshed.');
    } catch {
      setItems([]);
      setLoadError(true);
      if (announce) say(lang === 'hi-IN' ? 'Hisaab abhi load nahi ho saka. Thodi der baad dobara boliye.' : 'I could not load activity just now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [lang, say]);

  const describeItem = useCallback((item: ActivityItem, index: number, total: number) => {
    const direction = item.direction === 'IN'
      ? (lang === 'hi-IN' ? 'aaye' : 'received from')
      : (lang === 'hi-IN' ? 'bheje' : 'sent to');
    const amount = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(item.amount);
    if (lang === 'hi-IN') {
      return `${total > 1 ? `Len-den ${index + 1} mein, ` : ''}${item.counterparty} se ${amount} ${direction}, ${spokenDate(item.time, lang)}. Status ${item.status}. ${item.paypalStatus ? `PayPal status ${item.paypalStatus}.` : ''} ${item.source}.`;
    }
    return `${total > 1 ? `Transaction ${index + 1}: ` : ''}${direction === 'received from' ? `Received ${amount} from` : `Sent ${amount} to`} ${item.counterparty}, ${spokenDate(item.time, lang)}. Status: ${item.status}.${item.paypalStatus ? ` PayPal reports ${item.paypalStatus}.` : ''} ${item.source}.`;
  }, [lang]);

  const handleVoiceCommand = useCallback(async (rawText: string) => {
    setLastHeard(rawText);
    triggerHaptic('understood');
    try {
      const response = await fetch('/api/agent/understand', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: rawText,
          screen: 'activity',
          language: lang,
          conversationState: 'idle',
          preferences: {
            theme: document.documentElement.dataset.theme || 'light',
            knownRecipients: [...new Set(items.map((item) => item.counterparty))].slice(0, 100),
            activityFilter,
          },
          // Only disclose the fields needed to answer transaction questions.
          transactionContext: items.map((item) => ({
            amount: item.amount,
            counterparty: item.counterparty,
            time: item.time,
            direction: item.direction,
          })),
        }),
      });
      const decision = await response.json();
      if (!response.ok) throw new Error(decision.error || 'The voice assistant could not process that request.');

      if (decision.action === 'check_balance') {
        const balanceResponse = await fetch('/api/family/wallet-paypal-balance');
        const data = await balanceResponse.json();
        if (!balanceResponse.ok || !data.success) throw new Error(data.error || 'PayPal balance is unavailable.');
        const amount = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(Number(data.available));
        setPaypalBalance(amount);
        setBalanceError(null);
        say(lang === 'hi-IN' ? `PayPal Sandbox mein ${amount} available hain.` : `Your PayPal Sandbox available balance is ${amount}.`);
        return;
      }

      if (decision.action === 'activity_query') {
        const visibleItems = filteredItems;
        const operation = decision.operation as string;
        if (operation === 'search_transactions') {
          const recipient = typeof decision.recipient === 'string' ? normalized(decision.recipient) : '';
          const dateFilter = typeof decision.exactDate === 'string' ? decision.exactDate : '';
          const matching = items.filter((item) => {
            if (decision.transactionDirection && decision.transactionDirection !== 'ANY' && item.direction !== decision.transactionDirection) return false;
            const counterparty = normalized(item.counterparty);
            if (recipient && !closeRecipientMatch(counterparty, recipient)) return false;
            if (dateFilter) {
              const date = new Date(item.time);
              if (Number.isNaN(date.getTime())) return false;
              const monthDay = `--${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              if (dateFilter.startsWith('--') ? monthDay !== dateFilter : localDate !== dateFilter) return false;
            }
            return true;
          });
          const eligible = matching.filter((item) => !['failed', 'cancelled', 'denied'].includes(item.status.toLowerCase()));
          const completed = eligible.filter((item) => item.status.toLowerCase() === 'completed');
          const pending = eligible.filter((item) => !completed.includes(item));
          const total = completed.reduce((sum, item) => sum + item.amount, 0);
          const currency = (value: number) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(value);
          const transactionsText = completed.slice(0, 10).map((item) => `${currency(item.amount)} to ${item.counterparty} on ${spokenDate(item.time, lang)}`).join('. ');
          const pendingTotal = pending.reduce((sum, item) => sum + item.amount, 0);
          let balanceText = '';
          if (decision.includeBalance) {
            try {
              const balanceResponse = await fetch('/api/family/wallet-paypal-balance');
              const data = await balanceResponse.json();
              if (!balanceResponse.ok || !data.success) throw new Error(data.error || 'unavailable');
              const available = currency(Number(data.available));
              setPaypalBalance(available);
              setBalanceError(null);
              balanceText = lang === 'hi-IN' ? ` PayPal ka baaki balance ${available} hai.` : ` Your current PayPal available balance is ${available}.`;
            } catch {
              balanceText = lang === 'hi-IN' ? ' PayPal ka current balance abhi nahi mil saka.' : ' I could not load the current PayPal balance.';
            }
          }
          const answer = eligible.length
            ? `${completed.length} completed transaction${completed.length === 1 ? '' : 's'}, totaling ${currency(total)}.${transactionsText ? ` ${transactionsText}${completed.length > 10 ? '. I read the first ten completed matches.' : ''}` : ''}${pending.length ? ` ${pending.length} more ${pending.length === 1 ? 'transaction is' : 'transactions are'} not complete yet, totaling ${currency(pendingTotal)}.` : ''}${balanceText}`
            : `I could not find a completed matching transaction${recipient ? ` for ${decision.recipient}` : ''}${dateFilter ? ` on ${dateFilter.replace(/^--/, '')}` : ''}.${balanceText}`;
          say(answer);
          return;
        }
        if (operation === 'balance' || decision.action === 'check_balance') {
          const balanceResponse = await fetch('/api/family/wallet-paypal-balance');
          const data = await balanceResponse.json();
          if (!balanceResponse.ok || !data.success) throw new Error(data.error || 'PayPal balance is unavailable.');
          const amount = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(Number(data.available));
          setPaypalBalance(amount);
          setBalanceError(null);
          say(lang === 'hi-IN' ? `PayPal Sandbox mein ${amount} available hain.` : `Your PayPal Sandbox available balance is ${amount}.`);
          return;
        }
        if (operation === 'refresh') {
          await loadActivity(true);
          return;
        }
        if (operation === 'filter_all' || operation === 'filter_sent' || operation === 'filter_received') {
          const nextFilter: ActivityFilter = operation === 'filter_sent' ? 'sent' : operation === 'filter_received' ? 'received' : 'all';
          const nextItems = nextFilter === 'all'
            ? items
            : items.filter((item) => item.direction === (nextFilter === 'sent' ? 'OUT' : 'IN'));
          setActivityFilter(nextFilter);
          setSelectedIndex(0);
          const label = nextFilter === 'all' ? (lang === 'hi-IN' ? 'sabhi' : 'all') : nextFilter === 'sent' ? (lang === 'hi-IN' ? 'bheje gaye' : 'sent') : (lang === 'hi-IN' ? 'mile hue' : 'received');
          say(lang === 'hi-IN'
            ? `${label} len-den dikha rahi hoon. ${nextItems.length} record mile.`
            : `Showing ${label} activity. ${nextItems.length} ${nextItems.length === 1 ? 'transaction' : 'transactions'} found.`);
          return;
        }
        if (!visibleItems.length) {
          say(loading
            ? (lang === 'hi-IN' ? 'Hisaab load ho raha hai. Ek pal mein dobara poochhein.' : 'Activity is still loading. Please ask me again in a moment.')
            : loadError
              ? (lang === 'hi-IN' ? 'Hisaab load nahi hua. Aap dobara koshish kar sakte hain.' : 'Activity did not load. You can ask me to refresh it.')
              : (lang === 'hi-IN' ? 'Abhi koi len-den nahi hai.' : 'There are no transactions yet.'));
          return;
        }
        if (operation === 'latest') {
          setSelectedIndex(0);
          say(describeItem(visibleItems[0], 0, visibleItems.length));
          return;
        }
        if (operation === 'next' || operation === 'previous') {
          const index = Math.max(0, Math.min(visibleItems.length - 1, selectedIndex + (operation === 'next' ? 1 : -1)));
          setSelectedIndex(index);
          say(describeItem(visibleItems[index], index, visibleItems.length));
          return;
        }
        if (operation === 'spending_summary') {
          const start = new Date(0);
          const now = new Date();
          if (decision.timeframe === 'today') start.setTime(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());
          else if (decision.timeframe === 'week') {
            const monday = new Date(now);
            monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
            monday.setHours(0, 0, 0, 0);
            start.setTime(monday.getTime());
          } else if (decision.timeframe === 'month') start.setTime(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
          const recipient = typeof decision.recipient === 'string' ? normalized(decision.recipient) : '';
          const matching = visibleItems.filter((item) => item.direction === 'OUT'
            && !['failed', 'cancelled', 'denied'].includes(item.status.toLowerCase())
            && new Date(item.time) >= start
            && (!recipient || normalized(item.counterparty).includes(recipient) || recipient.includes(normalized(item.counterparty))));
          const total = matching.reduce((sum, item) => sum + item.amount, 0);
          const amount = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(total);
          say(lang === 'hi-IN'
            ? `${decision.timeframe === 'today' ? 'Aaj' : decision.timeframe === 'week' ? 'Is hafte' : decision.timeframe === 'month' ? 'Is mahine' : 'Kul'} ${matching.length} payment ka kul kharch ${amount} hai.`
            : `You have ${matching.length} outgoing ${decision.timeframe === 'today' ? 'payments today' : decision.timeframe === 'week' ? 'payments this week' : decision.timeframe === 'month' ? 'payments this month' : 'payments'}, totaling ${amount}${recipient ? ` for ${decision.recipient}` : ''}.`);
          return;
        }
        if (operation === 'recipient_summary') {
          const recipient = typeof decision.recipient === 'string' ? normalized(decision.recipient) : '';
          if (!recipient) {
            say(lang === 'hi-IN' ? 'Kis vyakti ya dukaan ke len-den ke baare mein pooch rahe hain?' : 'Which person or shop should I look for?');
            return;
          }
          const matches = visibleItems.filter((item) => normalized(item.counterparty).includes(recipient) || recipient.includes(normalized(item.counterparty)));
          if (!matches.length) {
            say(lang === 'hi-IN' ? `${decision.recipient} ke naam ka koi len-den nahi mila.` : `I could not find a transaction for ${decision.recipient}.`);
            return;
          }
          const total = matches.reduce((sum, item) => sum + (['failed', 'cancelled', 'denied'].includes(item.status.toLowerCase()) ? 0 : item.amount), 0);
          const amount = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(total);
          say(lang === 'hi-IN'
            ? `${matches[0].counterparty} ke saath ${matches.length} len-den mile, kul ${amount}. Sabse naya: ${describeItem(matches[0], 0, 1)}`
            : `I found ${matches.length} transactions with ${matches[0].counterparty}, totaling ${amount}. Most recent: ${describeItem(matches[0], 0, 1)}`);
          return;
        }
        if (operation === 'read_all') {
          const preview = visibleItems.slice(0, 5).map((item, index) => describeItem(item, index, Math.min(visibleItems.length, 5))).join(' ');
          say(lang === 'hi-IN' ? `Kul ${visibleItems.length} len-den hain. ${preview}` : `You have ${visibleItems.length} transactions. ${preview}`);
          return;
        }
        if (operation === 'read_last_n') {
          const count = Math.max(1, Math.min(20, Number(decision.count) || 5));
          const recent = visibleItems.slice(0, count);
          const preview = recent.map((item, index) => describeItem(item, index, recent.length)).join(' ');
          say(lang === 'hi-IN'
            ? `Aapke ${recent.length} sabse naye len-den. ${preview || 'Abhi koi len-den nahi hai.'}`
            : `Here are your ${recent.length} most recent transactions. ${preview || 'There are no transactions yet.'}`);
          return;
        }
      }

      if (decision.action === 'navigate') {
        if (decision.destination === 'wallet') {
          voiceActiveRef.current = false;
          setVoiceActive(false);
          goHomeAfterSpeechRef.current = true;
          say(String(decision.replyText));
        } else {
          voiceActiveRef.current = false;
          setVoiceActive(false);
          navigateAfterSpeechRef.current = () => onNavigate?.(decision.destination);
          say(String(decision.replyText));
        }
        return;
      }
      if (decision.action === 'set_preference') {
        onSetPreference?.(String(decision.preference), String(decision.value));
        say(String(decision.replyText));
        return;
      }
      if (decision.action === 'repeat') {
        repeatLastReplyRef.current();
        return;
      }
      if (decision.action === 'stop_listening') {
        voiceActiveRef.current = false;
        setVoiceActive(false);
        stopListeningRef.current();
        say(String(decision.replyText));
        return;
      }
      if (decision.action === 'delegate_conversation') {
        voiceActiveRef.current = false;
        setVoiceActive(false);
        stopListeningRef.current();
        onDelegateConversation?.(rawText);
        return;
      }

      say(String(decision.replyText || 'Please tell me a little more.'));
    } catch (error) {
      say((error as Error).message || 'The voice assistant could not process that request.');
    }
  }, [activityFilter, describeItem, filteredItems, items, lang, loadActivity, loadError, loading, onDelegateConversation, onNavigate, onSetPreference, say, selectedIndex]);

  const onVoiceError = useCallback((_code: string, friendly: string) => {
    voiceActiveRef.current = false;
    setVoiceActive(false);
    say(friendly);
  }, [say]);

  const { isListening, isSupported, startListening, stopListening, error: micError } = useSpeechRecognition({
    lang,
    onResult: handleVoiceCommand,
    onError: onVoiceError,
  });
  startListeningRef.current = startListening;
  stopListeningRef.current = stopListening;

  useEffect(() => { void loadActivity(); }, [loadActivity]);

  useEffect(() => {
    if (!initialVoiceRequest || loading || initialRequestHandledRef.current) return;
    initialRequestHandledRef.current = true;
    onInitialVoiceRequestHandled?.();
    void handleVoiceCommand(initialVoiceRequest);
  }, [handleVoiceCommand, initialVoiceRequest, loading, onInitialVoiceRequestHandled]);

  useEffect(() => {
    if (autoStartVoice && !initialVoiceRequest && !initialRequestHandledRef.current) {
      voiceActiveRef.current = true;
      setVoiceActive(true);
      const timer = window.setTimeout(() => say(lang === 'hi-IN'
        ? 'Aapka hisaab taiyaar hai. Aakhri payment, aakhri paanch len-den, bheje ya mile paise, kisi vyakti ka naam, is hafte ka kharch, PayPal balance, ya refresh poochhein. Wallet home jaane ke liye ghar jao boliye.'
        : 'Activity is ready. Ask for your latest payment, last five transactions, sent or received money, a person, spending by date, PayPal balance, or refresh. Say “go home” to return to Wallet.'), 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [autoStartVoice, initialVoiceRequest, lang, say]);

  const handleMic = () => {
    if (isListening || voiceActiveRef.current) {
      voiceActiveRef.current = false;
      setVoiceActive(false);
      stopListening();
      say(lang === 'hi-IN' ? 'Sunna rok diya. Dobara bolne ke liye mic dabayein.' : 'Listening paused. Tap the microphone to speak again.');
      return;
    }
    voiceActiveRef.current = true;
    setVoiceActive(true);
    setAssistantReply('');
    startListening();
  };

  const status = loading
    ? (lang === 'hi-IN' ? 'Hisaab load ho raha hai' : 'Loading activity')
    : isListening
      ? (lang === 'hi-IN' ? 'Sun rahi hoon' : 'Listening')
      : isSpeaking
        ? (lang === 'hi-IN' ? 'Bol rahi hoon' : 'Speaking')
        : voiceActive
          ? (lang === 'hi-IN' ? 'Bolkar poochhein' : 'Ask me about your activity')
          : (lang === 'hi-IN' ? 'Baat karne ke liye mic dabayein' : 'Tap the mic to talk');

  return (
    <Page
      headerContent={
        <>
          <DotWordmark size={120} />
          <Headline level={1}>{lang === 'hi-IN' ? 'Aapka len-den' : 'Recent Activity'}</Headline>
          <BodyText muted>{lang === 'hi-IN' ? 'Apne payments ke baare mein bolkar poochhein.' : 'Ask questions about your payments by voice.'}</BodyText>
          <button
            type="button"
            onClick={onGoHome}
            aria-label={lang === 'hi-IN' ? 'Wallet home par wapas jaayein' : 'Return to Wallet home'}
            style={{ minHeight: 56, marginTop: '0.75rem', padding: '0.7rem 1.2rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
          >
            {lang === 'hi-IN' ? '← वॉलेट होम' : '← Wallet home'}
          </button>
        </>
      }
    >
      {loadError && (
        <StatusBanner variant="danger" label={lang === 'hi-IN' ? 'Hisaab load nahi hua' : 'Activity unavailable'}>
          {lang === 'hi-IN' ? 'Aap mic se “refresh” bolkar dobara koshish kar sakte hain.' : 'Say “refresh” to try loading it again.'}
        </StatusBanner>
      )}
      {!isSupported && (
        <StatusBanner variant="warning" label={lang === 'hi-IN' ? 'Voice support zaroori hai' : 'Voice input unavailable'}>
          {lang === 'hi-IN' ? 'Is browser mein voice input nahi chalta. Kripya Chrome ya Edge kholein.' : 'Voice input is not supported in this browser. Please open Awaaz Pay in Chrome or Edge.'}
        </StatusBanner>
      )}

      <section aria-label="Voice activity assistant" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', width: '100%', padding: '0.5rem 0' }}>
        <button
          type="button"
          onClick={handleMic}
          disabled={!isSupported || loading}
          aria-label={isListening || voiceActive ? 'Stop activity voice assistant' : 'Ask about recent activity'}
          aria-pressed={voiceActive}
          style={{
            width: 'min(48vw, 190px)', height: 'min(48vw, 190px)', minWidth: '140px', minHeight: '140px',
            borderRadius: '50%', border: '4px solid var(--border)',
            background: isListening ? 'var(--accent)' : 'var(--surface)',
            color: isListening ? 'var(--accent-text)' : 'var(--text)',
            display: 'grid', placeItems: 'center', cursor: 'pointer',
            boxShadow: isListening ? '0 0 0 10px rgba(56, 189, 248, 0.15)' : '0 8px 30px rgba(0,0,0,0.08)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.55rem' }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            </svg>
            <span style={{ fontWeight: 750 }}>{isListening ? (lang === 'hi-IN' ? 'Sun rahi hoon' : 'Listening') : (lang === 'hi-IN' ? 'Poochhein' : 'Ask me')}</span>
          </span>
        </button>
        <div role="status" aria-live="polite" style={{ fontSize: 'var(--text-body-large)', textAlign: 'center', fontWeight: 700 }}>{status}</div>
        <BodyText muted style={{ textAlign: 'center' }}>
          {lang === 'hi-IN'
            ? 'Ya mic se boliye: “mera aakhri payment”, “is hafte kitna kharch hua”, “agla”, “PayPal balance batao”, ya “ghar jao”.'
            : 'Or ask the mic: “my latest payment”, “how much did I spend this week”, “next”, “check PayPal balance”, or “go home”.'}
        </BodyText>
        {(lastHeard || assistantReply || micError || balanceError) && (
          <div aria-live="polite" aria-atomic="true" style={{ width: '100%', padding: '1rem', border: '2px solid var(--border)', borderRadius: 'var(--radius-card, 16px)', background: 'var(--surface)' }}>
            {lastHeard && <BodyText><strong>{lang === 'hi-IN' ? 'Aapne kaha:' : 'You said:'}</strong> {lastHeard}</BodyText>}
            {(assistantReply || micError || balanceError) && <BodyText muted style={{ marginTop: lastHeard ? '0.5rem' : 0 }}>{assistantReply || micError || balanceError}</BodyText>}
          </div>
        )}
      </section>

      {paypalBalance && <BodyText size="large">{lang === 'hi-IN' ? `PayPal available balance: ${paypalBalance}` : `PayPal available balance: ${paypalBalance}`}</BodyText>}
      {balanceError && <BodyText muted>{balanceError}</BodyText>}
      <section aria-label={lang === 'hi-IN' ? 'Len-den filter' : 'Activity filters'} style={{ width: '100%', marginTop: '0.5rem' }}>
        <div role="group" aria-label={lang === 'hi-IN' ? 'Dikhaye gaye len-den chunein' : 'Choose which transactions to show'} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem' }}>
          {([
            { key: 'all', icon: '📋', label: lang === 'hi-IN' ? 'Sabhi' : 'All', count: items.length },
            { key: 'sent', icon: '↗️', label: lang === 'hi-IN' ? 'Bheje' : 'Sent', count: items.filter((item) => item.direction === 'OUT').length },
            { key: 'received', icon: '↙️', label: lang === 'hi-IN' ? 'Mile' : 'Received', count: items.filter((item) => item.direction === 'IN').length },
          ] as const).map((filter) => {
            const isActive = activityFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => { setActivityFilter(filter.key); setSelectedIndex(0); }}
                style={{
                  minHeight: 'var(--min-target, 64px)', padding: '0.55rem 0.35rem',
                  borderRadius: 'var(--radius-pill)', border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--accent)' : 'var(--surface)',
                  color: isActive ? 'var(--accent-text)' : 'var(--text)',
                  font: 'inherit', fontSize: '0.95rem', fontWeight: 750, cursor: 'pointer',
                }}
              >
                {filter.icon} {filter.label} ({filter.count})
              </button>
            );
          })}
        </div>
        <p aria-live="polite" style={{ marginTop: '0.55rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          {activityFilter === 'all'
            ? (lang === 'hi-IN' ? 'Saare len-den' : 'All activity')
            : activityFilter === 'sent'
              ? (lang === 'hi-IN' ? 'Aapke bheje hue payments' : 'Payments you sent')
              : (lang === 'hi-IN' ? 'Aapko mile hue payments' : 'Payments you received')}
        </p>
      </section>
      {loadError ? null : filteredItems.length === 0 && !loading ? (
        <BodyText size="large" muted>{lang === 'hi-IN' ? 'Abhi koi len-den nahi hai.' : 'No transactions yet.'}</BodyText>
      ) : (
        <ol aria-label={lang === 'hi-IN' ? 'Len-den ki soochi' : 'Transaction list'} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
          {filteredItems.map((item, index) => (
            <li key={item.id} aria-current={index === selectedIndex ? 'true' : undefined} style={{ minHeight: '76px', padding: '1rem', background: 'var(--surface)', border: `2px solid ${index === selectedIndex ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-card, 16px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <BodyText size="large">{lang === 'hi-IN'
                  ? `${item.counterparty} ${item.direction === 'IN' ? 'se' : 'ko'} ${new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(item.amount)} ${item.direction === 'IN' ? 'mile' : 'bheje'}`
                  : `${item.direction === 'IN' ? 'Received' : 'Sent'} ${new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(item.amount)} ${item.direction === 'IN' ? 'from' : 'to'} ${item.counterparty}`}</BodyText>
                <BodyText muted>{spokenDate(item.time, lang)} · {item.status} · {item.source}{item.paypalStatus ? ` · PayPal: ${item.paypalStatus}` : ''}</BodyText>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
};
