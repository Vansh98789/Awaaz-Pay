import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis.js';
import { triggerHaptic } from './hooks/useHaptics.js';
import {
  Page,
  DotWordmark,
  DotRing,
  Headline,
  BodyText,
  StatusBanner,
  type DotRingState,
} from './design/index.js';
import { GuardianApprovePage } from './pages/GuardianApprovePage.js';
import { OnboardingWizard } from './pages/OnboardingWizard.js';
import { MerchantDemoPage } from './pages/MerchantDemoPage.js';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage.js';
import { FamilyGate } from './pages/FamilyGate.js';
import { DesignPreviewPage } from './pages/DesignPreviewPage.js';
import { ActivityScreen } from './pages/ActivityScreen.js';
import { ConfirmPaymentScreen } from './pages/ConfirmPaymentScreen.js';
import { QRScannerModal } from './components/QRScannerModal.js';
import { parseVoiceCommand } from './voice/commands.js';

// Route money requests directly into the transaction conversation. That flow
// has its own LLM intent parser plus the required risk checks and confirmation.
// This is a domain handoff, not phrase matching for a particular command.
function isPaymentConversationUtterance(text: string): boolean {
  return /\b(send|sending|pay|paying|transfer|transferring|payment|payments|purchase|buy|bhej(?:na|o|do|dijiye)?|bhugtan|ada(?:y)?gi|de\s*(?:do|dijiye)|paise?\s*(?:bhej|do))\b/i.test(text)
    || /(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:usd|us dollars?|dollars?|rupees?|inr)\b)/i.test(text)
    || /\bgive\b.{0,40}\b(money|cash|dollars?|rupees?|to)\b/i.test(text);
}

function isExplicitScannerRequest(text: string): boolean {
  return /\b(scanner|camera|qr(?: code)?)\b/i.test(text)
    && /\b(open|show|start|launch|scan|use|through|with|kholo|kholiye|स्कैन|खोल)\b/i.test(text);
}

function settingButtonStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 48,
    padding: '0.65rem 0.9rem',
    borderRadius: 'var(--radius-pill, 999px)',
    border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'var(--accent)' : 'var(--surface)',
    color: selected ? 'var(--accent-text)' : 'var(--text)',
    font: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

interface TranscriptEntry {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  time: string;
}

interface PendingConfirmationState {
  isOpen: boolean;
  payeeName: string;
  amount: number;
  currency?: string;
  contextSentence?: string;
  warningText?: string;
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
  invoiceId?: string;
  paymentMode?: 'paypal_invoice' | 'awaaz_pay_payout';
}

interface ScannedRecipient {
  name: string;
  email: string;
}

function parseScannedRecipient(qrData: string): ScannedRecipient | null {
  const raw = qrData.trim();
  let name = '';
  let email = '';

  try {
    if (raw.startsWith('{')) {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      if (payload.type !== 'awaaz-pay-recipient') return null;
      name = typeof payload.name === 'string' ? payload.name.trim() : '';
      email = typeof payload.paypalEmail === 'string' ? payload.paypalEmail.trim() : '';
    } else if (/^awaazpay:\/\/recipient/i.test(raw)) {
      const url = new URL(raw);
      name = url.searchParams.get('name')?.trim() ?? '';
      email = url.searchParams.get('email')?.trim() ?? '';
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      email = raw;
    }
  } catch {
    return null;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!name) name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (name.length < 1 || name.length > 80) return null;
  return { name, email };
}

export const App: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<{
    path: 'wallet' | 'approve' | 'onboarding' | 'merchant' | 'family' | 'design-preview' | 'activity';
    token?: string;
  }>(() => {
    const path = typeof window !== 'undefined' ? window.location.pathname : '/';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (path.startsWith('/approve/')) {
      return { path: 'approve', token: path.replace('/approve/', '').replace(/^\//, '') };
    }
    if (hash.startsWith('#/approve/') || hash.startsWith('#approve/')) {
      return { path: 'approve', token: hash.replace(/^#(|\/)approve\//, '') };
    }
    if (path === '/onboarding' || hash.includes('onboarding')) return { path: 'onboarding' };
    if (path === '/merchant' || hash.includes('merchant')) return { path: 'merchant' };
    if (path === '/family' || hash.includes('family')) return { path: 'family' };
    if (path === '/design-preview' || hash.includes('design-preview')) return { path: 'design-preview' };
    if (path === '/activity' || hash.includes('activity')) return { path: 'activity' };
    return { path: 'wallet' };
  });
  const currentRouteRef = useRef(currentRoute);
  currentRouteRef.current = currentRoute;

  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('en-IN');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('awaaz_theme') : null;
    const initial = saved === 'light' || saved === 'dark'
      ? saved
      : typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = initial;
    return initial;
  });
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerEmailEntryOpen, setScannerEmailEntryOpen] = useState(false);
  const [scannerRestartToken, setScannerRestartToken] = useState(0);
  const [awaitingPaymentRecipient, setAwaitingPaymentRecipient] = useState(false);
  const [pendingScanPaymentRequest, setPendingScanPaymentRequest] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [micPermissionReady, setMicPermissionReady] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsAwaitingChoice, setSettingsAwaitingChoice] = useState(false);
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [isThinking, setIsThinking] = useState(false);
  const [conversationState, setConversationState] = useState('idle');
  const [isContinuousVoice, setIsContinuousVoice] = useState(true);

  const continuousVoiceRef = useRef(isContinuousVoice);
  continuousVoiceRef.current = isContinuousVoice;

  const startListeningRef = useRef<() => void>(() => {});
  const autoListenAfterNavigationRef = useRef(false);
  const pageVoiceSessionRef = useRef(false);
  const [pendingActivityRequest, setPendingActivityRequest] = useState<string | null>(null);

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmationState>({
    isOpen: false,
    payeeName: '',
    amount: 0,
  });

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sess-${Date.now()}`
  );

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    localStorage.setItem('awaaz_theme', themeMode);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeMode === 'dark' ? '#0E0E0F' : '#F8F8F6');
  }, [themeMode]);

  const handleSpeechEnd = useCallback(() => {
    if (currentRouteRef.current.path !== 'wallet') return;
    if (autoListenAfterNavigationRef.current || pageVoiceSessionRef.current) {
      autoListenAfterNavigationRef.current = false;
      window.setTimeout(() => startListeningRef.current(), 350);
      return;
    }
    // Blind-First Hands-Free Voice: automatically resume listening after assistant speaks
    if (continuousVoiceRef.current) {
      setTimeout(() => {
        startListeningRef.current();
      }, 350);
    }
  }, []);

  const { speak, repeatLastReply, isSpeaking, speed, setSpeed, outputMode, setOutputMode } =
    useSpeechSynthesis({
      defaultLang: lang,
      defaultSpeed: 1.0,
      onEnd: handleSpeechEnd,
    });

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text:
        lang === 'hi-IN'
          ? 'नमस्ते। बोलिए, मैं सुन रही हूँ।'
          : 'Tap the microphone once, then talk naturally. Say “help” for voice commands.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // Route popstate listener
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path.startsWith('/approve/')) {
        setCurrentRoute({ path: 'approve', token: path.replace('/approve/', '').replace(/^\//, '') });
      } else if (hash.startsWith('#/approve/') || hash.startsWith('#approve/')) {
        setCurrentRoute({ path: 'approve', token: hash.replace(/^#(|\/)approve\//, '') });
      } else if (path === '/onboarding' || hash.includes('onboarding')) {
        setCurrentRoute({ path: 'onboarding' });
      } else if (path === '/merchant' || hash.includes('merchant')) {
        setCurrentRoute({ path: 'merchant' });
      } else if (path === '/family' || hash.includes('family')) {
        setCurrentRoute({ path: 'family' });
      } else if (path === '/design-preview' || hash.includes('design-preview')) {
        setCurrentRoute({ path: 'design-preview' });
      } else if (path === '/activity' || hash.includes('activity')) {
        setCurrentRoute({ path: 'activity' });
      } else {
        setCurrentRoute({ path: 'wallet' });
      }
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  // Offline / Online listeners
  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      triggerHaptic('error');
      const offlineMsg =
        lang === 'hi-IN'
          ? 'इंटरनेट कनेक्शन चला गया है। कृपया नेटवर्क चेक करें।'
          : 'Internet connection lost. Please check your network connection.';
      speak(offlineMsg, { lang });
    };

    const handleOnline = () => {
      setIsOffline(false);
      triggerHaptic('understood');
      const onlineMsg =
        lang === 'hi-IN'
          ? 'इंटरनेट कनेक्शन वापस जुड़ गया है।'
          : 'Internet connection restored.';
      speak(onlineMsg, { lang });
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [lang, speak]);

  const handleSpeechResult = async (text: string, agentAlreadyDelegated = false) => {
    triggerHaptic('understood');
    setIsThinking(true);

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userEntry: TranscriptEntry = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text,
      time: nowTime,
    };
    setTranscripts((prev) => [...prev, userEntry]);

    const parsedCommand = pendingConfirmation.isOpen ? parseVoiceCommand(text) : null;
    let command: ReturnType<typeof parseVoiceCommand> = parsedCommand === 'read_history' ? 'open_activity' : parsedCommand;
    const normalized = text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[.,!?;:।]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (awaitingPaymentRecipient && /\b(e-?mail|email address)\b/i.test(text) && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
      setScannerEmailEntryOpen(true);
      setIsThinking(false);
      const reply = lang === 'hi-IN'
        ? 'PayPal Sandbox email boliye ya screen par type karke Continue dabaiye.'
        : 'Say the PayPal Sandbox email, or type it on screen and press Continue.';
      setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
      speak(reply, { lang });
      return;
    }

    // Handle voice answers to confirmation screen if open
    if (pendingConfirmation.isOpen) {
      const affirmative = /^(?:haan|ha|ji|yes|yeah|y|ok|okay|confirm|confirm payment|pay now|bhej do|bhej dijiye|kar do|theek hai|bilkul|हाँ|हां|जी|कर दो|भेज दो)$/i.test(normalized);
      const negative = /^(?:nahi|nahin|no|nope|cancel|stop|ruko|mat bhejo|don't pay|do not pay|नहीं|नही|रोक दो|मत भेजो)$/i.test(normalized);
      if (affirmative) {
        setIsThinking(false);
        handleExecutePayment();
        return;
      }
      if (negative) {
        setPendingConfirmation({ isOpen: false, payeeName: '', amount: 0 });
        const cancelMsg = lang === 'hi-IN' ? 'Payment cancel kar diya gaya.' : 'Payment cancelled.';
        speak(cancelMsg, { lang });
        setIsThinking(false);
        return;
      }
      if (pendingConfirmation.isSuccess || pendingConfirmation.isFailed || pendingConfirmation.isPending || pendingConfirmation.isApprovalPending || pendingConfirmation.isBlocked) {
        if (command === 'go_home' || command === 'go_back' || command === 'close_confirmation') {
          setPendingConfirmation({ isOpen: false, payeeName: '', amount: 0 });
          const done = lang === 'hi-IN' ? 'Theek hai, payment screen band kar di.' : 'Okay, closing the payment screen.';
          speak(done, { lang });
          setIsThinking(false);
          return;
        }
        const safeVoiceActions: string[] = ['repeat', 'help', 'check_paypal_balance', 'open_activity', 'open_family', 'open_settings', 'open_scanner', 'close_scanner', 'retry_scanner', 'close_confirmation', 'go_home', 'go_back'];
        if (!command || !safeVoiceActions.includes(command)) {
          const done = lang === 'hi-IN' ? 'Payment screen band karne ke liye ghar jao boliye.' : 'Say “go home” to close this payment screen.';
          speak(done, { lang });
          setIsThinking(false);
          return;
        }
      } else if (command !== 'repeat' && command !== 'help' && command !== 'check_paypal_balance' && command !== 'open_activity' && command !== 'open_family' && command !== 'open_settings' && command !== 'open_scanner') {
        setIsThinking(false);
        const confirmMsg = lang === 'hi-IN'
          ? 'Payment abhi nahi bheja gaya. Bhejne ke liye haan, cancel karne ke liye nahi boliye.'
          : 'The payment has not been sent. Say yes to send it, or no to cancel.';
        setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: confirmMsg, time: nowTime }]);
        speak(confirmMsg, { lang });
        return;
      }
    }

    // Let the LLM infer the user's goal from the utterance and current screen.
    // Only the structured, allowlisted action returned by the server is executed.
    const paymentConversationActive = conversationState !== 'idle';
    const scannerRequested = isExplicitScannerRequest(text);
    const routeToPaymentConversation = (paymentConversationActive || isPaymentConversationUtterance(text)) && !scannerRequested;
    if (!pendingConfirmation.isOpen && !agentAlreadyDelegated && !routeToPaymentConversation) {
      try {
        const agentResponse = await fetch('/api/agent/understand', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            screen: isSettingsOpen ? 'settings' : isScannerOpen ? 'scanner' : ['wallet', 'settings', 'activity', 'family', 'merchant', 'scanner'].includes(currentRoute.path) ? currentRoute.path : 'wallet',
            language: lang,
            conversationState,
            preferences: {
              theme: themeMode,
              outputMode,
              speechSpeed: speed,
              handsFree: isContinuousVoice,
              scannerOpen: isScannerOpen,
            },
          }),
        });
        const decision = await agentResponse.json();
        if (!agentResponse.ok) throw new Error(decision.error || 'The voice assistant could not understand that request.');

        if (decision.action === 'navigate') {
          setIsThinking(false);
          const voicePage = ['settings', 'scanner'].includes(decision.destination);
          pageVoiceSessionRef.current = voicePage;
          autoListenAfterNavigationRef.current = ['wallet', 'settings', 'scanner'].includes(decision.destination);
          setIsSettingsOpen(decision.destination === 'settings');
          setSettingsAwaitingChoice(decision.destination === 'settings');
          if (decision.destination === 'scanner') {
            setIsScannerOpen(true);
            if (scannerRequested && (paymentConversationActive || isPaymentConversationUtterance(text))) {
              setAwaitingPaymentRecipient(true);
              setPendingScanPaymentRequest(isPaymentConversationUtterance(text) ? text : null);
            }
          } else {
            setIsScannerOpen(false);
          }
          if (decision.destination === 'activity') {
            setCurrentRoute({ path: 'activity' });
          } else if (decision.destination === 'family') {
            setCurrentRoute({ path: 'family' });
          } else if (decision.destination === 'merchant') {
            setCurrentRoute({ path: 'merchant' });
          } else {
            setCurrentRoute({ path: 'wallet' });
          }
          const pagePrompt = decision.destination === 'scanner'
            ? (lang === 'hi-IN'
              ? 'QR scanner khul gaya. PayPal invoice ya recipient QR scan karein. QR scan ke baad main payment details bataungi. Ghar jaane ke liye wallet kholo boliye.'
              : 'The QR scanner is open. Scan a PayPal invoice or recipient QR. I will explain the payment details after the scan. Say “go home” to return to Wallet.')
            : decision.destination === 'settings'
              ? (lang === 'hi-IN'
                ? 'Settings khul gayi. Theme, language, bolne ki raftaar, voice ya screen reader, aur hands-free badalne ke liye boliye. Ghar jaane ke liye wallet kholo boliye.'
                : 'Settings are open. Say what you want to change: theme, language, speech speed, voice or screen reader, or hands-free. Say “go home” to return to Wallet.')
              : decision.destination === 'wallet'
                ? (lang === 'hi-IN' ? 'Wallet home khul gaya. Kya karna chahenge?' : 'Wallet home is open. What would you like to do?')
                : String(decision.replyText || 'Okay.');
          const reply = pagePrompt;
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          if (decision.destination !== 'activity') speak(reply, { lang });
          return;
        }

        if (decision.action === 'set_preference') {
          const value = String(decision.value || '');
          if (decision.preference === 'theme') setThemeMode(value as 'light' | 'dark');
          else if (decision.preference === 'language') setLang(value as 'hi-IN' | 'en-IN');
          else if (decision.preference === 'speech_speed') {
            setSpeed(value === 'slower' ? Math.max(0.6, speed - 0.2) : value === 'faster' ? Math.min(1.6, speed + 0.2) : 1);
          } else if (decision.preference === 'output_mode') setOutputMode(value as 'voice' | 'screen_reader');
          else if (decision.preference === 'hands_free') {
            const enabled = value === 'on';
            setIsContinuousVoice(enabled);
            continuousVoiceRef.current = enabled;
          }
          setSettingsAwaitingChoice(false);
          setIsThinking(false);
          const responseLanguage = decision.preference === 'language' ? value as 'hi-IN' | 'en-IN' : lang;
          const reply = String(decision.replyText || 'Setting updated.');
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          speak(reply, { lang: responseLanguage });
          return;
        }

        if (decision.action === 'clarify') {
          if (isPaymentConversationUtterance(text)) {
            // The transaction intent parser is better equipped to ask for a
            // missing amount/payee and preserves the payment safety flow.
            command = null;
          } else {
          setIsThinking(false);
          setSettingsAwaitingChoice(isSettingsOpen);
          const reply = String(decision.replyText || 'Please tell me a little more.');
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          speak(reply, { lang });
          return;
          }
        }

        if (decision.action === 'check_balance') command = 'check_paypal_balance';
        else if (decision.action === 'repeat') command = 'repeat';
        else if (decision.action === 'stop_listening') command = 'stop_listening';
        else if (decision.action === 'activity_query') {
          setIsThinking(false);
          setIsSettingsOpen(false);
          setPendingActivityRequest(text);
          setCurrentRoute({ path: 'activity' });
          return;
        } else if (decision.action === 'delegate_conversation') command = null;
      } catch (err) {
        if (isPaymentConversationUtterance(text)) {
          // Keep payments usable if the general navigation planner is down;
          // /api/converse still applies payment parsing, risk checks and consent.
        } else {
        setIsThinking(false);
        const reply = (err as Error).message || (lang === 'hi-IN' ? 'Voice assistant abhi available nahi hai.' : 'The voice assistant is unavailable right now.');
        setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
        speak(reply, { lang });
        return;
        }
      }
    }

    if (command) {
      if (command === 'repeat') {
        setIsThinking(false);
        repeatLastReply();
        return;
      }
      if (command === 'stop_listening') {
        setIsThinking(false);
        setIsContinuousVoice(false);
        continuousVoiceRef.current = false;
        stopListening();
        const reply = lang === 'hi-IN'
          ? 'Sunna rok diya. Dobara bolne ke liye mic button dabayein.'
          : 'Listening stopped. Tap the microphone button when you want to speak again.';
        setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
        speak(reply, { lang });
        return;
      }
      if (command === 'language_en' || command === 'language_hi') {
        const nextLang = command === 'language_hi' ? 'hi-IN' : 'en-IN';
        setLang(nextLang);
        const reply = command === 'language_hi' ? 'Ab main Hindi mein baat karungi.' : 'I will speak English now.';
        setSettingsAwaitingChoice(false);
        setIsThinking(false);
        speak(isSettingsOpen ? `${reply} ${nextLang === 'hi-IN' ? 'Aur kya badalna hai? Theme ya bolne ki raftaar boliye. Band karne ke liye settings band karo boliye.' : 'What else would you like to change? Say theme or speech speed. Say close settings when you are done.'}` : reply, { lang: nextLang });
        return;
      }
      if (command === 'slower' || command === 'faster' || command === 'normal_speed') {
        const nextSpeed = command === 'slower' ? Math.max(0.6, speed - 0.2) : command === 'faster' ? Math.min(1.6, speed + 0.2) : 1;
        setSpeed(nextSpeed);
        const reply = command === 'slower'
          ? (lang === 'hi-IN' ? 'Main dheere bolungi.' : 'I will speak more slowly.')
          : command === 'faster'
            ? (lang === 'hi-IN' ? 'Main tez bolungi.' : 'I will speak faster.')
            : (lang === 'hi-IN' ? 'Bolne ki raftaar saamanya kar di.' : 'Speech speed is back to normal.');
        setSettingsAwaitingChoice(false);
        setIsThinking(false);
        speak(isSettingsOpen ? `${reply} ${lang === 'hi-IN' ? 'Aur kya badalna hai? Theme ya language boliye, ya settings band karo boliye.' : 'What else would you like to change? Say theme or language, or close settings.'}` : reply, { lang });
        return;
      }
      if (command === 'voice_mode' || command === 'screen_reader_mode') {
        const nextMode = command === 'voice_mode' ? 'voice' : 'screen_reader';
        setOutputMode(nextMode);
        const reply = command === 'voice_mode'
          ? (lang === 'hi-IN' ? 'Voice mode chalu hai.' : 'Voice mode is on.')
          : (lang === 'hi-IN' ? 'Screen reader mode chalu hai.' : 'Screen reader mode is on.');
        setSettingsAwaitingChoice(false);
        setIsThinking(false);
        speak(isSettingsOpen ? `${reply} ${lang === 'hi-IN' ? 'Aur kya badalna hai? Settings band karne ke liye settings band karo boliye.' : 'What else would you like to change? Say close settings when you are done.'}` : reply, { lang });
        return;
      }
      if (command === 'handsfree_on' || command === 'handsfree_off') {
        const enabled = command === 'handsfree_on';
        setIsContinuousVoice(enabled);
        continuousVoiceRef.current = enabled;
        setSettingsAwaitingChoice(false);
        const reply = enabled
          ? (lang === 'hi-IN' ? 'Hands-free mode chalu hai.' : 'Hands-free listening is on.')
          : (lang === 'hi-IN' ? 'Hands-free mode band hai. Dobara shuru karne ke liye mic dabayein.' : 'Hands-free listening is off. Tap the mic to start again.');
        setIsThinking(false);
        speak(isSettingsOpen && enabled ? `${reply} ${lang === 'hi-IN' ? 'Aur kya badalna hai? Theme ya language boliye.' : 'What else would you like to change? Say theme or language.'}` : reply, { lang });
        return;
      }
      if (command === 'check_paypal_balance') {
        try {
          const res = await fetch('/api/family/wallet-paypal-balance');
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'PayPal balance is unavailable.');
          const available = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
          }).format(Number(data.available));
          const refreshed = data.asOf
            ? (lang === 'hi-IN'
              ? ` Report time ${new Date(data.asOf).toLocaleString()}.`
              : ` Report time: ${new Date(data.asOf).toLocaleString()}.`)
            : '';
          const reply = lang === 'hi-IN'
            ? `PayPal Sandbox business account mein ${available} available hain. Report teen ghante tak purani ho sakti hai.${refreshed}`
            : `The PayPal Sandbox business account has ${available} available. This report may be up to three hours old.${refreshed}`;
          window.dispatchEvent(new CustomEvent('awaaz-paypal-balance', { detail: { balance: available } }));
          setIsThinking(false);
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          speak(reply, { lang });
        } catch (err) {
          const reply = (err as Error).message || (lang === 'hi-IN' ? 'PayPal balance nahi mil saka.' : 'Could not read the PayPal balance.');
          window.dispatchEvent(new CustomEvent('awaaz-paypal-balance', { detail: { error: reply } }));
          setIsThinking(false);
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          speak(reply, { lang });
        }
        return;
      }

      let reply = '';
      if (command === 'help') {
        reply = isSettingsOpen
          ? (lang === 'hi-IN'
            ? 'Theme, language, bolne ki raftaar, voice mode, screen reader mode, ya hands-free badalne ke liye uska naam boliye. Settings band karne ke liye settings band karo boliye.'
            : 'Say theme, language, speech speed, voice mode, screen reader mode, or hands-free to change it. Say close settings when you are done.')
          : lang === 'hi-IN'
          ? 'Payment ke liye naam aur dollar boliye. Scanner kholo, PayPal balance batao, hisaab sunao, family portal kholo, dobara bolo, Hindi ya English bolo, dheere bolo, settings kholo, ya ghar jao.'
          : 'Say what you want: send dollars to a contact, open scanner, check PayPal balance, read history, open the family portal, repeat what I said, switch language, speak slower, open settings, or go home.';
      } else if (command === 'open_scanner') {
        setIsScannerOpen(true);
        setIsSettingsOpen(false);
        pageVoiceSessionRef.current = true;
        reply = lang === 'hi-IN'
          ? 'QR scanner khol diya. Camera permission maange to allow karein. Code ko camera ke saamne rakhein. Band karne ke liye scanner band karo boliye.'
          : 'Opening the QR scanner and camera. Allow camera access if asked, then point it at the code. Say close scanner to exit.';
      } else if (command === 'close_scanner') {
        if (isScannerOpen) {
          setIsScannerOpen(false);
          pageVoiceSessionRef.current = false;
          autoListenAfterNavigationRef.current = true;
          reply = lang === 'hi-IN' ? 'Scanner band kar diya.' : 'Scanner closed.';
        } else {
          reply = lang === 'hi-IN' ? 'Scanner abhi khula nahi hai.' : 'The scanner is not open.';
        }
      } else if (command === 'retry_scanner') {
        setIsScannerOpen(true);
        setScannerRestartToken((current) => current + 1);
        reply = lang === 'hi-IN' ? 'Camera dobara shuru kar rahi hoon.' : 'Restarting the camera now.';
      } else if (command === 'open_activity') {
        setIsScannerOpen(false);
        setIsSettingsOpen(false);
        pageVoiceSessionRef.current = false;
        setCurrentRoute({ path: 'activity' });
        reply = lang === 'hi-IN' ? 'Aapka hisaab khol rahi hoon.' : 'Opening your recent activity.';
      } else if (command === 'open_family') {
        setIsScannerOpen(false);
        setIsSettingsOpen(false);
        setCurrentRoute({ path: 'family' });
        reply = lang === 'hi-IN' ? 'Family dashboard khol raha hoon.' : 'Opening the family dashboard.';
      } else if (command === 'open_settings') {
        setIsScannerOpen(false);
        pageVoiceSessionRef.current = true;
        if (currentRoute.path !== 'wallet') setCurrentRoute({ path: 'wallet' });
        setIsSettingsOpen(true);
        setSettingsAwaitingChoice(true);
        reply = lang === 'hi-IN'
          ? 'Settings khol di. Aap kya badalna chahte hain? Light ya dark theme, Hindi ya English, bolne ki raftaar, voice mode, ya hands-free boliye.'
          : 'Settings are open. What would you like to change? Say light or dark theme, Hindi or English, speech speed, voice mode, or hands-free.';
      } else if (command === 'close_settings') {
        setIsSettingsOpen(false);
        setSettingsAwaitingChoice(false);
        pageVoiceSessionRef.current = false;
        reply = lang === 'hi-IN' ? 'Settings band kar di.' : 'Settings closed.';
      } else if (command === 'open_merchant') {
        setIsScannerOpen(false);
        setIsSettingsOpen(false);
        setCurrentRoute({ path: 'merchant' });
        reply = lang === 'hi-IN' ? 'Merchant portal khol raha hoon.' : 'Opening the merchant portal.';
      } else if (command === 'go_home' || command === 'go_back') {
        pageVoiceSessionRef.current = false;
        autoListenAfterNavigationRef.current = true;
        if (isScannerOpen) {
          setIsScannerOpen(false);
          reply = lang === 'hi-IN' ? 'Scanner band karke wallet par wapas aa gaya.' : 'Closed the scanner and returned to the wallet.';
        } else if (isSettingsOpen) {
          setIsSettingsOpen(false);
          setSettingsAwaitingChoice(false);
          reply = lang === 'hi-IN' ? 'Settings band karke wallet par wapas aa gaya.' : 'Closed settings and returned to the wallet.';
        } else if (currentRoute.path !== 'wallet') {
          setCurrentRoute({ path: 'wallet' });
          reply = lang === 'hi-IN' ? 'Wallet home khol raha hoon.' : 'Returning to the wallet home screen.';
        } else {
          reply = lang === 'hi-IN' ? 'Aap wallet home par hain.' : 'You are already on the wallet home screen.';
        }
      }

      setIsThinking(false);
      setTranscripts((prev) => [...prev, {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
        if (command !== 'open_activity') speak(reply, { lang });
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsThinking(false);
      triggerHaptic('error');
      const offlineMsg =
        lang === 'hi-IN'
          ? 'आप ऑफलाइन हैं। कृपया अपना कनेक्शन चेक करें।'
          : 'You are offline. Please check your internet connection.';
      speak(offlineMsg, { lang });
      setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: offlineMsg, time: nowTime }]);
      return;
    }

    try {
      const res = await fetch('/api/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          text,
          userId: 'user_meena',
          lang: lang === 'hi-IN' ? 'hi' : 'en',
        }),
      });

      setIsThinking(false);

      const data = (await res.json()) as {
        replyText: string;
        replyLanguage: 'hi' | 'en';
        state: string;
        context?: {
          pendingPayeeName?: string;
          pendingAmount?: number;
          isNewPayee?: boolean;
          scamRisk?: string;
        };
        actions?: {
          transactionId?: string;
          paymentStatus?: string;
          paypalBatchId?: string;
          paypalStatus?: string;
          provider?: string;
        };
      };
      if (!res.ok) throw new Error((data as { error?: string }).error || `Server returned HTTP ${res.status}`);
      setConversationState(data.state);

      // Detect Blocked payment state
      if (data.state === 'idle' && (data.replyText.includes('scam') || data.replyText.includes('rok') || data.replyText.includes('blocked'))) {
        triggerHaptic('blocked');
      }

      if (data.state === 'awaiting_payment_recipient') {
        setAwaitingPaymentRecipient(true);
        setScannerEmailEntryOpen(scannerEmailEntryOpen);
        setIsScannerOpen(true);
        pageVoiceSessionRef.current = true;
        setScanError(null);
        const replyLangCode = data.replyLanguage === 'en' ? 'en-IN' : 'hi-IN';
        setTranscripts((prev) => [...prev, {
          id: `a-${Date.now()}`, sender: 'assistant', text: data.replyText,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        speak(data.replyText, { lang: replyLangCode });
        return;
      }

      // Check if server asks for confirmation
      if (data.state === 'awaiting_confirmation') {
        if (awaitingPaymentRecipient || isScannerOpen) {
          setIsScannerOpen(false);
          setScannerEmailEntryOpen(false);
          setAwaitingPaymentRecipient(false);
          pageVoiceSessionRef.current = false;
          autoListenAfterNavigationRef.current = true;
        }
        const payeeName = data.context?.pendingPayeeName || 'Recipient';
        const amount = data.context?.pendingAmount || 0;
        setPendingConfirmation({
          isOpen: true,
          payeeName,
          amount,
          transactionId: data.actions?.transactionId,
          warningText: data.context?.isNewPayee ? 'New recipient: verify the exact PayPal email. Family approval or safety checks may apply.' : undefined,
          contextSentence: data.context?.isNewPayee
            ? `New recipient PayPal email: ${payeeName}.`
            : lang === 'hi-IN' ? 'एक सुरक्षित कांटेक्ट को।' : 'To a verified recipient.',
        });
        const replyLangCode = data.replyLanguage === 'en' ? 'en-IN' : 'hi-IN';
        speak(data.replyText, { lang: replyLangCode });
        return;
      }

      const replyLangCode = data.replyLanguage === 'en' ? 'en-IN' : 'hi-IN';
      const assistantEntry: TranscriptEntry = {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: data.replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setTranscripts((prev) => [...prev, assistantEntry]);
      speak(data.replyText, { lang: replyLangCode });
    } catch (err) {
      setIsThinking(false);
      triggerHaptic('error');
      if (awaitingPaymentRecipient) {
        setAwaitingPaymentRecipient(true);
        setIsScannerOpen(true);
        setScannerEmailEntryOpen(true);
        pageVoiceSessionRef.current = true;
        const emailError = (err as Error).message || 'Could not prepare this recipient email.';
        const retryMessage = lang === 'hi-IN'
          ? `Email se payment taiyaar nahi ho saka. ${emailError} Email dobara check karke try karein.`
          : `I could not prepare the payment using that email. ${emailError} Please check the address and try again.`;
        setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: retryMessage, time: nowTime }]);
        speak(retryMessage, { lang });
        return;
      }
      const fallbackText =
        lang === 'hi-IN'
          ? 'Awaaz Pay se jawab nahi mila. Payment dobara karne se pehle Recent Activity check karein, taaki galti se do baar na bhejein. Internet check karke help bol sakte hain.'
          : 'I could not get a response from Awaaz Pay. Check Recent Activity before retrying a payment so you do not send it twice. Check your connection or say help.';

      const assistantEntry: TranscriptEntry = {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: fallbackText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setTranscripts((prev) => [...prev, assistantEntry]);
      speak(fallbackText, { lang });
    }
  };

  const handleSpeechError = (code: string, friendlyMsg: string) => {
    setIsThinking(false);
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      setMicPermissionReady(false);
    }
    triggerHaptic('error');
    speak(friendlyMsg, { lang });
  };

  const { isListening, isSupported: sttSupported, toggleListening, startListening, stopListening, error } =
    useSpeechRecognition({
      lang,
      onResult: handleSpeechResult,
      onError: handleSpeechError,
    });

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // Handle start listening haptics
  const handleMicClick = async () => {
    setMicPermissionError(null);
    if (isListening) {
      setIsContinuousVoice(false);
      continuousVoiceRef.current = false;
      toggleListening();
      return;
    }
    if (!micPermissionReady) {
      if (!window.isSecureContext) {
        const message = lang === 'hi-IN'
          ? 'Mobile par microphone ke liye secure HTTPS address zaroori hai. App ka https:// link kholein, local IP wala http:// link nahi.'
          : 'Microphone access on mobile requires a secure HTTPS address. Open the app’s https:// link, not an http:// local network address.';
        setMicPermissionError(message);
        speak(message, { lang });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        const message = lang === 'hi-IN'
          ? 'Is browser mein microphone access available nahi hai. Chrome ya Safari ka latest version kholein.'
          : 'Microphone access is unavailable in this browser. Open the latest Chrome or Safari.';
        setMicPermissionError(message);
        speak(message, { lang });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        setMicPermissionReady(true);
        const message = lang === 'hi-IN'
          ? 'Microphone taiyaar hai. Ab boliye, main sun rahi hoon.'
          : 'The microphone is ready. Go ahead and speak.';
        setMicPermissionError(message);
        speak(message, { lang, onEnd: startListening });
      } catch (err) {
        const error = err as Error & { name?: string };
        const message = error.name === 'NotAllowedError'
          ? (lang === 'hi-IN'
            ? 'Microphone permission blocked hai. Browser site settings mein Microphone ko Allow karein; phone Settings mein bhi permission check karein.'
            : 'Microphone permission is blocked. Allow Microphone in this site’s browser settings, and check your phone settings too.')
          : error.name === 'NotFoundError'
            ? (lang === 'hi-IN' ? 'Microphone nahi mila.' : 'No microphone was found on this device.')
            : (lang === 'hi-IN' ? 'Microphone shuru nahi ho saka. Dobara koshish karein.' : 'Could not start the microphone. Please try again.');
        setMicPermissionError(message);
        speak(message, { lang });
      }
      return;
    }
    triggerHaptic('listeningStart');
    toggleListening();
  };

  // Keyboard accessibility: Space or Enter starts and stops listening
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept keystrokes when focus is inside interactive elements
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLButtonElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.closest('button, a, input, textarea, select')
      ) {
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleMicClick();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isListening]);

  // Execution when user confirms payment
  const handleExecutePayment = async () => {
    try {
      setPendingConfirmation((prev) => ({ ...prev, isProcessing: true }));
      triggerHaptic('understood');
      let outcome: {
        status?: string;
        replyText?: string;
        message?: string;
        spokenMessage?: string;
        transactionId?: string;
        paypalBatchId?: string;
        batchId?: string;
        paypalStatus?: string;
      };

      if (pendingConfirmation.invoiceId) {
        const res = await fetch('/api/invoices/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            invoiceId: pendingConfirmation.invoiceId,
            userId: 'user_meena',
            confirm: true,
          }),
        });
        outcome = await res.json();
        if (!res.ok && outcome.status !== 'need_guardian_approval') {
          throw new Error(outcome.message || outcome.spokenMessage || 'PayPal payout failed.');
        }
        outcome.paypalBatchId = outcome.paypalBatchId || outcome.batchId;
      } else {
        const res = await fetch('/api/converse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            text: lang === 'hi-IN' ? 'Haan' : 'Yes',
            userId: 'user_meena',
            lang: lang === 'hi-IN' ? 'hi' : 'en',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Payment request failed (${res.status}).`);
        outcome = {
          status: data.actions?.paymentStatus,
          replyText: data.replyText,
          transactionId: data.actions?.transactionId,
          paypalBatchId: data.actions?.paypalBatchId,
          paypalStatus: data.actions?.paypalStatus,
        };
      }

      const statusMessage = [
        outcome.replyText || outcome.message || outcome.spokenMessage || '',
        outcome.paypalStatus ? `PayPal reports ${outcome.paypalStatus}.` : '',
      ].filter(Boolean).join(' ');
      const completed = outcome.status === 'completed';
      const approvalPending = outcome.status === 'awaiting_approval' || outcome.status === 'need_guardian_approval';
      const pending = outcome.status === 'processing' || approvalPending;
      setPendingConfirmation((prev) => ({
        ...prev,
        isProcessing: false,
        isSuccess: completed,
        isPending: pending,
        isApprovalPending: approvalPending,
        isFailed: !completed && !pending,
        statusMessage,
        transactionId: outcome.transactionId,
        paypalBatchId: outcome.paypalBatchId,
      }));

      if (completed) triggerHaptic('confirmed');
      else if (!pending) triggerHaptic('error');
      const spokenStatus = completed
        ? `${lang === 'hi-IN' ? 'PayPal Sandbox test payment safal raha. Asli paise nahi bheje gaye.' : 'PayPal Sandbox test payment completed. No real money was moved.'} ${statusMessage}`
        : pending
          ? `${lang === 'hi-IN' ? 'PayPal Sandbox payment abhi confirm nahi hua. Dobara payment na karein.' : 'PayPal Sandbox has not confirmed this payment yet. Do not retry it.'} ${statusMessage}`
          : `${lang === 'hi-IN' ? 'PayPal Sandbox payment safal nahi hua. Dobara bhejne se pehle PayPal activity check karein.' : 'PayPal Sandbox did not confirm the payment. Check PayPal activity before retrying.'} ${statusMessage}`;
      speak(spokenStatus.trim(), { lang });
    } catch (err) {
      triggerHaptic('error');
      setPendingConfirmation((prev) => ({
        ...prev,
        isProcessing: false,
        isFailed: true,
        statusMessage: (err as Error).message || (lang === 'hi-IN'
          ? 'Payment ka result confirm nahi hua. Dobara bhejne se pehle PayPal activity check karein.'
          : 'The payment result could not be confirmed. Check PayPal activity before retrying.'),
      }));
      speak((err as Error).message || 'Payment did not complete.', { lang });
    }
  };

  const handleScanSuccess = async (qrData: string) => {
    setIsScannerOpen(false);
    setScanError(null);
    triggerHaptic('understood');

    const recipient = parseScannedRecipient(qrData);
    if (recipient) {
      try {
        const alias = recipient.name;
        const res = await fetch('/api/contacts/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alias,
            displayName: recipient.name,
            paypalEmail: recipient.email,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not add this recipient');
        if (awaitingPaymentRecipient) {
          const scanPaymentText = pendingScanPaymentRequest
            ? `${pendingScanPaymentRequest}. PayPal recipient email: ${recipient.email}`
            : `Send money to ${recipient.email}`;
          const paymentRes = await fetch('/api/converse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              text: scanPaymentText,
              userId: 'user_meena',
              lang: lang === 'hi-IN' ? 'hi' : 'en',
            }),
          });
          const paymentData = await paymentRes.json();
          if (!paymentRes.ok) throw new Error(paymentData.error || 'Could not prepare this payment');
          setConversationState(paymentData.state);
          setPendingScanPaymentRequest(null);
          if (paymentData.state === 'awaiting_payment_recipient') {
            setAwaitingPaymentRecipient(true);
            setScannerEmailEntryOpen(false);
            setIsScannerOpen(true);
            pageVoiceSessionRef.current = true;
            speak(paymentData.replyText, { lang });
            return;
          }
          setAwaitingPaymentRecipient(false);
          if (paymentData.state === 'awaiting_confirmation') {
            pageVoiceSessionRef.current = false;
            autoListenAfterNavigationRef.current = true;
            setPendingConfirmation({
              isOpen: true,
              payeeName: paymentData.context?.pendingPayeeName || recipient.name,
              amount: paymentData.context?.pendingAmount || 0,
              transactionId: paymentData.actions?.transactionId,
              warningText: 'Check this exact recipient email before confirming.',
              contextSentence: `Unverified PayPal recipient email: ${recipient.email}.`,
            });
          }
          const paymentReply = paymentData.replyText || 'Recipient details received.';
          setTranscripts((prev) => [...prev, {
            id: `a-${Date.now()}`, sender: 'assistant', text: paymentReply,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
          speak(paymentReply, { lang: paymentData.replyLanguage === 'en' ? 'en-IN' : 'hi-IN' });
          return;
        }
        const message = lang === 'hi-IN'
            ? (data.inCoolingOff
            ? `QR code mein naam ${recipient.name} aur PayPal email ${recipient.email} likha hai. Yeh jankari abhi PayPal se verify nahi hui hai. Naya payee suraksha ke liye cooling-off mein rakha hai. Is dauran payment ke liye parivaar ki manzoori zaroori hogi. Bhejne se pehle naam aur email us vyakti se verify karein.`
              : `${recipient.name} pehle se aapke contacts mein hain. QR mein diya PayPal email ${recipient.email} hai. Payment se pehle is email ko us vyakti se verify karein.`)
          : (data.inCoolingOff
            ? `This QR says ${recipient.name}, PayPal email ${recipient.email}. PayPal has not verified the name in this QR. I added the recipient in a safety hold; a family member must approve payments during the cooling-off period. Please verify the email with the person before sending.`
            : `${recipient.name} is already in your contacts. This QR says their PayPal email is ${recipient.email}. Please verify the email with them before sending.`);
        setTranscripts((prev) => [...prev, {
          id: `a-${Date.now()}`, sender: 'assistant', text: message,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        speak(message, { lang });
      } catch (err) {
        const message = (err as Error).message || (lang === 'hi-IN' ? 'Payee add nahi ho saka.' : 'Could not add this payee.');
        setScanError(message);
        speak(message, { lang });
      }
      return;
    }

    try {
      const res = await fetch('/api/invoices/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrData }),
      });
      const scanData = await res.json().catch(() => ({}));

      if (res.ok) {
        setAwaitingPaymentRecipient(false);
        setPendingScanPaymentRequest(null);
        const inv = scanData;
        setPendingConfirmation({
          isOpen: true,
          payeeName: inv.merchantName,
          amount: inv.amount,
          invoiceId: inv.invoiceId,
          paymentMode: inv.paymentMode,
          contextSentence: inv.paymentMode === 'awaaz_pay_payout'
            ? (lang === 'hi-IN'
              ? 'Awaaz Pay wallet QR. Haan kehne par PayPal Sandbox payout bheja jayega.'
              : 'Awaaz Pay wallet QR. Confirming sends a PayPal Sandbox test payout.')
            : (lang === 'hi-IN' ? `${inv.merchantName}, ek verified merchant.` : `To ${inv.merchantName}, a verified merchant.`),
        });
      } else {
        const detail = typeof scanData.error === 'string' ? scanData.error : '';
        const message = lang === 'hi-IN'
          ? `QR code ko payment ke liye verify nahi kar sake. Naya Awaaz Pay QR banwa kar scan karein.${detail ? ` ${detail}` : ''}`
          : `Could not verify this QR for payment. Ask the merchant to create a new Awaaz Pay QR and scan it again.${detail ? ` ${detail}` : ''}`;
        setScanError(message);
        speak(message, { lang });
      }
    } catch {
      const message = lang === 'hi-IN'
        ? 'QR code verify nahi ho saka. Dobara scan karein.'
        : 'Could not verify this QR code. Please scan again.';
      setScanError(message);
      speak(message, { lang });
    }
  };

  useEffect(() => {
    if (!pendingConfirmation.isPending || !pendingConfirmation.transactionId) return;

    let stopped = false;
    let attempts = 0;
    const pollStatus = async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/payments/${pendingConfirmation.transactionId}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        const tx = data.transaction;
        if (stopped || !tx) return;

        if (tx.status === 'completed') {
          setPendingConfirmation((prev) => ({
            ...prev,
            isPending: false,
            isSuccess: true,
            statusMessage: 'PayPal confirmed this sandbox payout.',
            paypalBatchId: tx.paypal_ref || prev.paypalBatchId,
          }));
          speak(lang === 'hi-IN'
            ? 'PayPal Sandbox ne payment confirm kar diya. Asli paise nahi bheje gaye.'
            : 'PayPal Sandbox confirmed the test payment. No real money was moved.', { lang });
          stopped = true;
        } else if (tx.status === 'failed') {
          const wasDenied = data.approvalStatus === 'denied';
          setPendingConfirmation((prev) => ({
            ...prev,
            isPending: false,
            isFailed: true,
            statusMessage: wasDenied
              ? 'Your family member denied this payment. No PayPal payout was sent.'
              : 'PayPal did not complete the payout. Check PayPal activity before retrying.',
          }));
          speak(wasDenied
            ? (lang === 'hi-IN'
              ? 'Aapki family ne payment manzoor nahi ki. PayPal ko payout nahi bheja gaya.'
              : 'Your family denied the payment. No PayPal payout was sent.')
            : (lang === 'hi-IN'
              ? 'PayPal payout safal nahi hua. Dobara bhejne se pehle PayPal activity check karein.'
              : 'PayPal did not complete the payout. Check PayPal activity before retrying.'), { lang });
          stopped = true;
        } else if (tx.status === 'awaiting_approval') {
          setPendingConfirmation((prev) => ({
            ...prev,
            isApprovalPending: true,
            statusMessage: attempts >= 10
              ? 'Family approval is still pending. No PayPal payout has been sent. Check Family Activity later; do not retry.'
              : 'Waiting for family approval. No PayPal payout has been sent.',
          }));
          if (attempts >= 10) stopped = true;
        } else if (tx.status === 'processing' && data.paypalStatus) {
          setPendingConfirmation((prev) => ({
            ...prev,
            statusMessage: attempts >= 10
              ? `PayPal reports ${data.paypalStatus}. Still not confirmed. Do not retry; check Recent Activity later.`
              : `PayPal reports ${data.paypalStatus}. Do not retry this payment.`,
          }));
          if (attempts >= 10) stopped = true;
        } else if (attempts >= 10) {
          setPendingConfirmation((prev) => ({
            ...prev,
            statusMessage: 'PayPal still has not confirmed completion. Do not retry; check Recent Activity later.',
          }));
          stopped = true;
        }
      } catch {
        if (attempts >= 10) stopped = true;
      }
    };

    const timer = window.setInterval(() => {
      if (!stopped) void pollStatus();
    }, 3000);
    void pollStatus();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pendingConfirmation.isPending, pendingConfirmation.transactionId, lang, speak]);

  // Determine DotRing state
  const ringState: DotRingState = isListening
    ? 'listening'
    : isSpeaking
      ? 'speaking'
      : isThinking
        ? 'speaking'
        : 'idle';

  const statusOneLine = isListening
    ? lang === 'hi-IN' ? 'सुन रही हूँ...' : 'Listening...'
    : isThinking
      ? lang === 'hi-IN' ? 'सोच रही हूँ...' : 'Thinking...'
      : isSpeaking
        ? lang === 'hi-IN' ? 'बोल रही हूँ...' : 'Speaking...'
        : lang === 'hi-IN'
          ? micPermissionReady ? 'बोलिए, मैं सुन रही हूँ' : 'शुरू करने के लिए माइक दबाएँ'
          : micPermissionReady ? 'Speak naturally' : 'Tap the mic once to begin';

  // Subpage routes
  if (currentRoute.path === 'approve' && currentRoute.token) {
    return <FamilyGate onExit={() => setCurrentRoute({ path: 'wallet' })}><GuardianApprovePage token={currentRoute.token} /></FamilyGate>;
  }
  if (currentRoute.path === 'onboarding') {
    return <OnboardingWizard />;
  }
  if (currentRoute.path === 'merchant') {
    return <MerchantDemoPage />;
  }
  if (currentRoute.path === 'family') {
    return <FamilyGate onExit={() => setCurrentRoute({ path: 'wallet' })}><FamilyDashboardPage /></FamilyGate>;
  }
  if (currentRoute.path === 'design-preview') {
    return <DesignPreviewPage />;
  }
  if (currentRoute.path === 'activity') {
    return (
      <ActivityScreen
        lang={lang}
        autoStartVoice
        initialVoiceRequest={pendingActivityRequest}
        onInitialVoiceRequestHandled={() => setPendingActivityRequest(null)}
        onGoHome={() => {
          pageVoiceSessionRef.current = false;
          setCurrentRoute({ path: 'wallet' });
          window.setTimeout(() => startListeningRef.current(), 350);
        }}
        onNavigate={(destination) => {
          if (destination === 'settings') {
            pageVoiceSessionRef.current = true;
            setCurrentRoute({ path: 'wallet' });
            setIsSettingsOpen(true);
            setSettingsAwaitingChoice(true);
            window.setTimeout(() => startListeningRef.current(), 350);
          } else if (destination === 'scanner') {
            pageVoiceSessionRef.current = true;
            setCurrentRoute({ path: 'wallet' });
            setIsScannerOpen(true);
            window.setTimeout(() => startListeningRef.current(), 350);
          } else if (destination === 'activity') {
            pageVoiceSessionRef.current = false;
            setCurrentRoute({ path: 'activity' });
          } else {
            pageVoiceSessionRef.current = false;
            setCurrentRoute({ path: destination });
            if (destination === 'wallet') window.setTimeout(() => startListeningRef.current(), 350);
          }
        }}
        onSetPreference={(preference, value) => {
          if (preference === 'theme') setThemeMode(value as 'light' | 'dark');
          else if (preference === 'language') setLang(value as 'hi-IN' | 'en-IN');
          else if (preference === 'speech_speed') setSpeed(value === 'slower' ? Math.max(0.6, speed - 0.2) : value === 'faster' ? Math.min(1.6, speed + 0.2) : 1);
          else if (preference === 'output_mode') setOutputMode(value as 'voice' | 'screen_reader');
          else if (preference === 'hands_free') {
            const enabled = value === 'on';
            setIsContinuousVoice(enabled);
            continuousVoiceRef.current = enabled;
          }
        }}
        onDelegateConversation={(utterance) => {
          setCurrentRoute({ path: 'wallet' });
          void handleSpeechResult(utterance, true);
        }}
      />
    );
  }

  // Confirm Payment Screen (Task C)
  if (pendingConfirmation.isOpen) {
    return (
      <ConfirmPaymentScreen
        payeeName={pendingConfirmation.payeeName}
        amount={pendingConfirmation.amount}
        contextSentence={pendingConfirmation.contextSentence}
        warningText={pendingConfirmation.warningText}
        isBlocked={pendingConfirmation.isBlocked}
        blockedReason={pendingConfirmation.blockedReason}
        isProcessing={pendingConfirmation.isProcessing}
        isSuccess={pendingConfirmation.isSuccess}
        isPending={pendingConfirmation.isPending}
        isApprovalPending={pendingConfirmation.isApprovalPending}
        isFailed={pendingConfirmation.isFailed}
        statusMessage={pendingConfirmation.statusMessage}
        transactionId={pendingConfirmation.transactionId}
        paypalBatchId={pendingConfirmation.paypalBatchId}
        speak={speak}
        lang={lang}
        isListening={isListening}
        onToggleMic={toggleListening}
      />
    );
  }

  return (
    <Page
      headerContent={
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <DotWordmark size={150} />
            <button
              type="button"
              onClick={() => { setSettingsAwaitingChoice(true); setIsSettingsOpen(true); }}
              style={{ minHeight: '48px', padding: '0.5rem 1rem', borderRadius: 'var(--radius-pill)', border: '2px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 700, cursor: 'pointer' }}
              aria-label={lang === 'hi-IN' ? 'Settings kholein' : 'Open settings'}
            >
              ⚙️ {lang === 'hi-IN' ? 'सेटिंग्स' : 'Settings'}
            </button>
          </div>
          <Headline level={1}>
            {lang === 'hi-IN' ? 'बोलिए। सुनिए। सुरक्षित पे करें।' : 'Say it. Hear it. Pay safely.'}
          </Headline>
        </>
      }
      footerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          {/* One-Line Status under Mic */}
          <div
            role="status"
            aria-live="polite"
            style={{
              textAlign: 'center',
              fontSize: 'var(--text-body-large)',
              fontWeight: 700,
              color: isListening ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {statusOneLine}
          </div>

          <BodyText muted style={{ textAlign: 'center' }}>
            {lang === 'hi-IN'
              ? 'Scanner kholo, merchant portal kholo, hisaab sunao, PayPal balance batao, family portal kholo, settings kholo, ya “dobara bolo” kahein.'
              : 'Say “open scanner”, “open merchant portal”, “read my history”, “check PayPal balance”, “open family portal”, “open settings”, or “repeat what you said”.'}
          </BodyText>
          <nav aria-label={lang === 'hi-IN' ? 'App pages' : 'App shortcuts'} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem', width: '100%', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={() => { setScanError(null); setIsScannerOpen(true); }}
              aria-label={lang === 'hi-IN' ? 'QR scanner kholein' : 'Open QR scanner'}
              style={{ minHeight: 'var(--min-target, 64px)', borderRadius: 'var(--radius-pill)', border: '2px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
            >
              📷 {lang === 'hi-IN' ? 'QR स्कैन' : 'Scan QR'}
            </button>
            <button
              type="button"
              onClick={() => { setPendingActivityRequest(null); setCurrentRoute({ path: 'activity' }); }}
              aria-label={lang === 'hi-IN' ? 'Recent activity kholein' : 'Open Recent Activity'}
              style={{ minHeight: 'var(--min-target, 64px)', borderRadius: 'var(--radius-pill)', border: '2px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
            >
              📜 {lang === 'hi-IN' ? 'हिसाब' : 'Activity'}
            </button>
            <button
              type="button"
              onClick={() => setCurrentRoute({ path: 'family' })}
              aria-label={lang === 'hi-IN' ? 'Password protected family portal kholein' : 'Open password-protected Family portal'}
              style={{ minHeight: 'var(--min-target, 64px)', borderRadius: 'var(--radius-pill)', border: '2px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
            >
              🛡️ {lang === 'hi-IN' ? 'परिवार' : 'Family'}
            </button>
            <button
              type="button"
              onClick={() => setCurrentRoute({ path: 'merchant' })}
              aria-label={lang === 'hi-IN' ? 'दुकानदार पोर्टल खोलें' : 'Open merchant portal'}
              style={{ minHeight: 'var(--min-target, 64px)', borderRadius: 'var(--radius-pill)', border: '2px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}
            >
              🏪 {lang === 'hi-IN' ? 'दुकानदार' : 'Merchant'}
            </button>
          </nav>
        </div>
      }
    >
      {/* Offline Alert Banner */}
      {isOffline && (
        <StatusBanner variant="danger" label="Offline">
          {lang === 'hi-IN'
            ? 'इंटरनेट कनेक्शन नहीं है। कृपया नेटवर्क चेक करें।'
            : 'You are offline. Please check your internet connection.'}
        </StatusBanner>
      )}

      {typeof window !== 'undefined' && !window.isSecureContext && (
        <StatusBanner variant="warning" label="Secure connection needed">
          {lang === 'hi-IN'
            ? 'Mobile par microphone aur camera ke liye app ka HTTPS link kholein. Local network ka http:// address kaam nahi karega.'
            : 'Microphone and camera need a secure connection on mobile. Open the app’s HTTPS link; a local network http:// address will not work.'}
        </StatusBanner>
      )}

      {/* Very large circular mic button (~60% viewport width, max 280px) surrounded by DotRing */}
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          margin: '1rem 0',
        }}
      >
        {!sttSupported ? (
          <StatusBanner variant="warning" label="Warning">
            {lang === 'hi-IN'
              ? 'ब्राउज़र में स्पीच रिकग्निशन सपोर्ट नहीं है। Chrome या Edge का उपयोग करें।'
              : 'Web Speech API is not supported in this browser. Please use Chrome or Edge.'}
          </StatusBanner>
        ) : (
          <DotRing state={ringState} radius={115}>
            <button
              type="button"
              onClick={handleMicClick}
              style={{
                width: 'min(60vw, 240px)',
                height: 'min(60vw, 240px)',
                borderRadius: '50%',
                backgroundColor: isListening ? 'var(--accent)' : 'var(--surface)',
                color: isListening ? 'var(--accent-text)' : 'var(--text)',
                border: '4px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
                transition: 'transform 0.15s ease, background-color 0.2s ease',
              }}
              aria-label={
                isListening
                  ? lang === 'hi-IN' ? 'सुनना बंद करें' : 'Stop listening'
                  : lang === 'hi-IN' ? 'बोलने के लिए यहाँ दबाएं' : 'Tap to speak'
              }
            >
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span style={{ fontSize: 'var(--text-body)', fontWeight: 700 }}>
                {isListening ? (lang === 'hi-IN' ? 'रोकें' : 'Stop') : (lang === 'hi-IN' ? 'बोलें' : 'Speak')}
              </span>
            </button>
          </DotRing>
        )}

        {(error || scanError || micPermissionError) && (
          <StatusBanner variant={micPermissionReady && micPermissionError ? 'success' : 'danger'} label={micPermissionReady && micPermissionError ? 'Microphone' : 'Error'}>
            {error || scanError || micPermissionError}
          </StatusBanner>
        )}

      </section>

      {/* Transcript of Conversation in Large Text (aria-live region) */}
      <section
        role="region"
        aria-live="polite"
        aria-label="Conversation transcript"
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          maxHeight: '260px',
          overflowY: 'auto',
          padding: '1rem',
          backgroundColor: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius-card, 16px)',
        }}
      >
        {transcripts.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              backgroundColor: entry.sender === 'user' ? 'var(--bg)' : 'transparent',
              borderLeft: entry.sender === 'assistant' ? '4px solid var(--accent)' : 'none',
            }}
          >
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              {entry.sender === 'user' ? (lang === 'hi-IN' ? 'आप' : 'You') : 'Awaaz Pay'} • {entry.time}
            </div>
            <BodyText size="large" style={{ fontWeight: entry.sender === 'assistant' ? 700 : 500 }}>
              {entry.text}
            </BodyText>
          </div>
        ))}
      </section>

      {/* QR Scanner Modal (Task D) */}
      <QRScannerModal
        isOpen={isScannerOpen}
        cameraCommand={scannerRestartToken}
        onScanSuccess={handleScanSuccess}
        allowEmailRecipient={awaitingPaymentRecipient}
        emailEntryOpen={scannerEmailEntryOpen}
        onEmailEntryOpenChange={setScannerEmailEntryOpen}
        onUseEmail={(email) => handleSpeechResult(email, true)}
        onReturnHome={() => {
          stopListening();
          setIsScannerOpen(false);
          pageVoiceSessionRef.current = false;
          autoListenAfterNavigationRef.current = true;
          speak(lang === 'hi-IN' ? 'Wallet home par wapas ja rahi hoon.' : 'Returning to Wallet home.', { lang });
        }}
        speak={speak}
        lang={lang}
      />

      {/* Settings Modal (Task B Output Modes) */}
      {isSettingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              maxHeight: '90dvh',
              overflowY: 'auto',
              backgroundColor: 'var(--bg)',
              color: 'var(--text)',
              borderRadius: 'var(--radius-card, 16px)',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: '2px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                stopListening();
                setIsSettingsOpen(false);
                setSettingsAwaitingChoice(false);
                pageVoiceSessionRef.current = false;
                autoListenAfterNavigationRef.current = true;
                speak(lang === 'hi-IN' ? 'Wallet home par wapas ja rahi hoon.' : 'Returning to Wallet home.', { lang });
              }}
              aria-label={lang === 'hi-IN' ? 'Wallet home par wapas jaayein' : 'Return to Wallet home'}
              style={{ alignSelf: 'flex-start', minHeight: 56, padding: '0.7rem 1.2rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
            >
              {lang === 'hi-IN' ? '← वॉलेट होम' : '← Wallet home'}
            </button>
            <Headline level={2}>{settingsAwaitingChoice
              ? (lang === 'hi-IN' ? 'कौन-सा विकल्प बदलना है?' : 'What would you like to change?')
              : (lang === 'hi-IN' ? 'और क्या बदलना है?' : 'What would you like to change next?')}</Headline>
            <BodyText size="large">
              {lang === 'hi-IN'
                ? 'Aap naturally bata sakte hain ki kya badalna hai—jaise screen ko halka karna, Hindi mein baat karna, ya dheere bolna. Agar mujhe aapki pasand samajh nahi aayi to main dobara poochungi.'
                : 'Tell me naturally what you want changed—for example, make the screen lighter, speak Hindi, or slow down. If I need your choice, I’ll ask a follow-up.'}
            </BodyText>
            <BodyText muted>
              {lang === 'hi-IN'
                ? `Abhi ${themeMode === 'light' ? 'light' : 'dark'} theme, Hindi, ${outputMode === 'voice' ? 'voice' : 'screen reader'} output, ${speed.toFixed(1)} guna bolne ki raftaar hai. Hands-free ${isContinuousVoice ? 'chalu' : 'band'} hai.`
                : `Current theme: ${themeMode}. Language: English. Output: ${outputMode === 'voice' ? 'spoken voice' : 'screen reader'}. Speech speed: ${speed.toFixed(1)}×. Hands-free is ${isContinuousVoice ? 'on' : 'off'}.`}
            </BodyText>
            <section aria-labelledby="theme-setting-title" style={{ display: 'grid', gap: '0.6rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
              <strong id="theme-setting-title">🎨 {lang === 'hi-IN' ? 'रंग और थीम' : 'Appearance'}</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <button type="button" aria-pressed={themeMode === 'light'} style={settingButtonStyle(themeMode === 'light')} onClick={() => setThemeMode('light')}>☀️ {lang === 'hi-IN' ? 'लाइट' : 'Light'}</button>
                <button type="button" aria-pressed={themeMode === 'dark'} style={settingButtonStyle(themeMode === 'dark')} onClick={() => setThemeMode('dark')}>🌙 {lang === 'hi-IN' ? 'डार्क' : 'Dark'}</button>
              </div>
            </section>
            <section aria-labelledby="language-setting-title" style={{ display: 'grid', gap: '0.6rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
              <strong id="language-setting-title">🗣️ {lang === 'hi-IN' ? 'भाषा' : 'Language'}</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <button type="button" aria-pressed={lang === 'en-IN'} style={settingButtonStyle(lang === 'en-IN')} onClick={() => setLang('en-IN')}>English</button>
                <button type="button" aria-pressed={lang === 'hi-IN'} style={settingButtonStyle(lang === 'hi-IN')} onClick={() => setLang('hi-IN')}>हिन्दी</button>
              </div>
            </section>
            <section aria-labelledby="speed-setting-title" style={{ display: 'grid', gap: '0.6rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
              <label id="speed-setting-title" htmlFor="speech-speed" style={{ fontWeight: 700 }}>🔉 {lang === 'hi-IN' ? 'बोलने की गति' : 'Speech speed'} · {speed.toFixed(1)}×</label>
              <input id="speech-speed" type="range" min="0.6" max="1.6" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-valuetext={`${speed.toFixed(1)} times`} style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                <button type="button" style={settingButtonStyle(false)} onClick={() => setSpeed(0.8)}>{lang === 'hi-IN' ? 'धीमी' : 'Slower'}</button>
                <button type="button" style={settingButtonStyle(speed === 1)} onClick={() => setSpeed(1)}>{lang === 'hi-IN' ? 'सामान्य' : 'Normal'}</button>
                <button type="button" style={settingButtonStyle(false)} onClick={() => setSpeed(1.3)}>{lang === 'hi-IN' ? 'तेज़' : 'Faster'}</button>
              </div>
            </section>
            <section aria-labelledby="output-setting-title" style={{ display: 'grid', gap: '0.6rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
              <strong id="output-setting-title">🔊 {lang === 'hi-IN' ? 'जवाब का तरीका' : 'Response mode'}</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <button type="button" aria-pressed={outputMode === 'voice'} style={settingButtonStyle(outputMode === 'voice')} onClick={() => setOutputMode('voice')}>🔊 {lang === 'hi-IN' ? 'आवाज़' : 'Voice'}</button>
                <button type="button" aria-pressed={outputMode === 'screen_reader'} style={settingButtonStyle(outputMode === 'screen_reader')} onClick={() => setOutputMode('screen_reader')}>♿ {lang === 'hi-IN' ? 'स्क्रीन रीडर' : 'Screen reader'}</button>
              </div>
            </section>
            <section aria-labelledby="handsfree-setting-title" style={{ display: 'grid', gap: '0.6rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
              <strong id="handsfree-setting-title">🎙️ {lang === 'hi-IN' ? 'Hands-free और माइक्रोफ़ोन' : 'Hands-free and microphone'}</strong>
              <BodyText muted>{micPermissionReady
                ? (lang === 'hi-IN' ? `माइक्रोफ़ोन अनुमति मिली। अभी ${isListening ? 'सुन रहा है' : 'रुका है'}।` : `Microphone permission granted. It is ${isListening ? 'listening' : 'paused'} now.`)
                : (lang === 'hi-IN' ? 'पहली बार माइक्रोफ़ोन चालू करने पर ब्राउज़र अनुमति माँगेगा।' : 'The browser will ask permission the first time you start the microphone.')}</BodyText>
              <button type="button" aria-pressed={isContinuousVoice} style={settingButtonStyle(isContinuousVoice)} onClick={() => {
                const enabled = !isContinuousVoice;
                setIsContinuousVoice(enabled);
                continuousVoiceRef.current = enabled;
                if (enabled && !micPermissionReady) setMicPermissionError(lang === 'hi-IN' ? 'Permission dene ke liye microphone button dabayein.' : 'Tap the microphone button to grant permission.');
                else if (enabled && !isListening) startListening();
                else if (!enabled && isListening) stopListening();
              }}>{isContinuousVoice ? '✅ ' : '⏸️ '}{lang === 'hi-IN' ? `Hands-free ${isContinuousVoice ? 'चालू' : 'बंद'}` : `Hands-free ${isContinuousVoice ? 'On' : 'Off'}`}</button>
              <button type="button" style={settingButtonStyle(isListening)} onClick={() => { void handleMicClick(); }} disabled={!sttSupported}>
                {isListening ? '⏹️ ' : '🎤 '}{lang === 'hi-IN' ? (isListening ? 'माइक्रोफ़ोन रोकें' : 'माइक्रोफ़ोन शुरू करें') : (isListening ? 'Stop microphone' : 'Start microphone')}
              </button>
              <BodyText muted>{lang === 'hi-IN' ? 'Hands-free चालू होने पर जवाब के बाद माइक्रोफ़ोन फिर सुनना शुरू करेगा। बंद करने के लिए “stop listening” बोलें।' : 'With hands-free on, the microphone listens again after each reply. Say “stop listening” to turn it off.'}</BodyText>
            </section>
            <StatusBanner variant="success" label={lang === 'hi-IN' ? 'बोलें या बटन चुनें' : 'Voice and touch controls'}>
              {lang === 'hi-IN'
                ? 'Mic se badlav boliye, ya neeche diya hua button chuniye.'
                : 'Say the change you want, or choose one of the controls below.'}
            </StatusBanner>
            <button type="button" style={settingButtonStyle(false)} onClick={() => { setIsSettingsOpen(false); setSettingsAwaitingChoice(false); }}>{lang === 'hi-IN' ? 'सेटिंग्स बंद करें' : 'Close settings'}</button>
          </div>
        </div>
      )}
    </Page>
  );
};

export default App;
