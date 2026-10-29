import React, { useCallback, useEffect, useRef, useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis.js';
import { triggerHaptic } from './hooks/useHaptics.js';
import {
  Page,
  DotWordmark,
  DotRing,
  Headline,
  BodyText,
  BigButton,
  StatusBanner,
  type DotRingState,
} from './design/index.js';
import { GuardianApprovePage } from './pages/GuardianApprovePage.js';
import { OnboardingWizard } from './pages/OnboardingWizard.js';
import { MerchantDemoPage } from './pages/MerchantDemoPage.js';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage.js';
import { DesignPreviewPage } from './pages/DesignPreviewPage.js';
import { ActivityScreen } from './pages/ActivityScreen.js';
import { ConfirmPaymentScreen } from './pages/ConfirmPaymentScreen.js';
import { QRScannerModal } from './components/QRScannerModal.js';
import { parseVoiceCommand } from './voice/commands.js';

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

  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('en-IN');
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [micPermissionReady, setMicPermissionReady] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [isThinking, setIsThinking] = useState(false);
  const [isContinuousVoice, setIsContinuousVoice] = useState(true);

  const continuousVoiceRef = useRef(isContinuousVoice);
  continuousVoiceRef.current = isContinuousVoice;

  const authStateRef = useRef(authState);
  authStateRef.current = authState;

  const startListeningRef = useRef<() => void>(() => {});

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmationState>({
    isOpen: false,
    payeeName: '',
    amount: 0,
  });

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sess-${Date.now()}`
  );

  const handleSpeechEnd = useCallback(() => {
    // Blind-First Hands-Free Voice: automatically resume listening after assistant speaks
    if (continuousVoiceRef.current && authStateRef.current === 'authenticated') {
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
          : 'Say it. Hear it. Pay safely. Tap the mic or speak to start.',
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

  // Auth status check
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          setAuthState('authenticated');
        } else {
          setAuthState('unauthenticated');
        }
      } catch {
        setAuthState('unauthenticated');
      }
    }
    checkAuth();
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

  const handleSpeechResult = async (text: string) => {
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

    const command = parseVoiceCommand(text);
    const normalized = text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[.,!?;:।]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

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
      if (command !== 'repeat' && command !== 'help') {
        setIsThinking(false);
        const confirmMsg = lang === 'hi-IN'
          ? 'Payment abhi nahi bheja gaya. Bhejne ke liye haan, cancel karne ke liye nahi boliye.'
          : 'The payment has not been sent. Say yes to send it, or no to cancel.';
        setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: confirmMsg, time: nowTime }]);
        speak(confirmMsg, { lang });
        return;
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
      if (command === 'check_paypal_balance') {
        try {
          const res = await fetch('/api/family/paypal-balance');
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
          setIsThinking(false);
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          speak(reply, { lang });
        } catch (err) {
          const reply = (err as Error).message || (lang === 'hi-IN' ? 'PayPal balance nahi mil saka.' : 'Could not read the PayPal balance.');
          setIsThinking(false);
          setTranscripts((prev) => [...prev, { id: `a-${Date.now()}`, sender: 'assistant', text: reply, time: nowTime }]);
          speak(reply, { lang });
        }
        return;
      }

      let reply = '';
      if (command === 'help') {
        reply = lang === 'hi-IN'
          ? 'Aap bol sakte hain: scanner kholo, activity dikhao, family kholo, settings kholo, ghar jao, balance batao, PayPal balance batao, history sunao, ya kisi contact ko paise bhejo. Sunna rokne ke liye stop listening boliye.'
          : 'You can say: open scanner, show activity, open family, open settings, go home, check my wallet balance, check my PayPal balance, read my history, or send money to a contact. Say stop listening to pause voice input.';
      } else if (command === 'open_scanner') {
        setIsScannerOpen(true);
        setIsSettingsOpen(false);
        reply = lang === 'hi-IN'
          ? 'QR scanner khul gaya. Camera shuru karne ke liye Enable camera button dabayein. Band karne ke liye cancel scanner boliye.'
          : 'The QR scanner is open. Tap Enable camera and scan to start the camera. Say close scanner to exit.';
      } else if (command === 'close_scanner') {
        if (isScannerOpen) {
          setIsScannerOpen(false);
          reply = lang === 'hi-IN' ? 'Scanner band kar diya.' : 'Scanner closed.';
        } else {
          reply = lang === 'hi-IN' ? 'Scanner abhi khula nahi hai.' : 'The scanner is not open.';
        }
      } else if (command === 'open_activity') {
        setIsScannerOpen(false);
        setIsSettingsOpen(false);
        setCurrentRoute({ path: 'activity' });
        reply = lang === 'hi-IN' ? 'Recent activity khol raha hoon.' : 'Opening recent activity.';
      } else if (command === 'open_family') {
        setIsScannerOpen(false);
        setIsSettingsOpen(false);
        setCurrentRoute({ path: 'family' });
        reply = lang === 'hi-IN' ? 'Family dashboard khol raha hoon.' : 'Opening the family dashboard.';
      } else if (command === 'open_settings') {
        setIsScannerOpen(false);
        if (currentRoute.path !== 'wallet') setCurrentRoute({ path: 'wallet' });
        setIsSettingsOpen(true);
        reply = lang === 'hi-IN' ? 'Settings khol raha hoon.' : 'Opening settings.';
      } else if (command === 'close_settings') {
        setIsSettingsOpen(false);
        reply = lang === 'hi-IN' ? 'Settings band kar di.' : 'Settings closed.';
      } else if (command === 'open_merchant') {
        setIsScannerOpen(false);
        setIsSettingsOpen(false);
        setCurrentRoute({ path: 'merchant' });
        reply = lang === 'hi-IN' ? 'Merchant portal khol raha hoon.' : 'Opening the merchant portal.';
      } else if (command === 'go_home' || command === 'go_back') {
        if (isScannerOpen) {
          setIsScannerOpen(false);
          reply = lang === 'hi-IN' ? 'Scanner band karke wallet par wapas aa gaya.' : 'Closed the scanner and returned to the wallet.';
        } else if (isSettingsOpen) {
          setIsSettingsOpen(false);
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
      speak(reply, { lang });
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

      if (res.status === 401) {
        setAuthState('unauthenticated');
        triggerHaptic('error');
        const unauthMsg =
          lang === 'hi-IN'
            ? 'सुरक्षा के लिए कृपया पहले फिंगरप्रिंट से लॉगिन करें।'
            : 'Please log in with your fingerprint first for safety.';
        speak(unauthMsg, { lang });
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        replyText: string;
        replyLanguage: 'hi' | 'en';
        state: string;
        context?: {
          pendingPayeeName?: string;
          pendingAmount?: number;
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

      // Detect Blocked payment state
      if (data.state === 'idle' && (data.replyText.includes('scam') || data.replyText.includes('rok') || data.replyText.includes('blocked'))) {
        triggerHaptic('blocked');
      }

      // Check if server asks for confirmation
      if (data.state === 'awaiting_confirmation') {
        const payeeName = data.context?.pendingPayeeName || 'Recipient';
        const amount = data.context?.pendingAmount || 0;
        setPendingConfirmation({
          isOpen: true,
          payeeName,
          amount,
          transactionId: data.actions?.transactionId,
          contextSentence: lang === 'hi-IN' ? 'एक सुरक्षित कांटेक्ट को।' : 'To a verified recipient.',
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
    } catch {
      setIsThinking(false);
      triggerHaptic('error');
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
          ? 'Microphone permission mil gayi. Ab boliye.'
          : 'Microphone permission granted. Please speak now.';
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

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const txt = textInput.trim();
    setTextInput('');
    handleSpeechResult(txt);
  };

  // Passkey Login Flow
  const handlePasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setAuthError(null);

      const guidance =
        lang === 'hi-IN' ? 'अपनी उंगली सेंसर पर रखें।' : 'Please place your finger on the sensor.';
      speak(guidance, { lang });

      const optRes = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena' }),
        credentials: 'include',
      });

      if (!optRes.ok) throw new Error('Failed to fetch login options');
      const options = await optRes.json();
      const authResp = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena', response: authResp }),
        credentials: 'include',
      });

      if (!verifyRes.ok) throw new Error('Verification failed');
      const verifyData = await verifyRes.json();
      if (verifyData.verified) {
        triggerHaptic('confirmed');
        setAuthState('authenticated');
        const successMsg =
          lang === 'hi-IN' ? 'लॉगिन सफल रहा! बोलिए, मैं सुन रही हूँ।' : 'Login successful! Speak, I am listening.';
        speak(successMsg, { lang });
      }
    } catch (err) {
      triggerHaptic('error');
      const errMsg = (err as Error).message;
      setAuthError(errMsg);
      const spokenErr =
        lang === 'hi-IN' ? 'लॉगिन नहीं हो पाया। दोबारा कोशिश करें।' : 'Fingerprint login failed. Please try again.';
      speak(spokenErr, { lang });
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handlePasskeyRegister = async () => {
    try {
      setIsPasskeyLoading(true);
      setAuthError(null);

      const guidance =
        lang === 'hi-IN'
          ? 'नया फिंगरप्रिंट जोड़ने के लिए उंगली सेंसर पर रखें।'
          : 'Place your finger on the sensor to register passkey.';
      speak(guidance, { lang });

      const optRes = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena' }),
        credentials: 'include',
      });

      if (!optRes.ok) throw new Error('Failed to fetch registration options');
      const options = await optRes.json();
      const regResp = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena', response: regResp }),
        credentials: 'include',
      });

      if (!verifyRes.ok) throw new Error('Registration verification failed');
      const verifyData = await verifyRes.json();
      if (verifyData.verified) {
        triggerHaptic('confirmed');
        setAuthState('authenticated');
        const successMsg =
          lang === 'hi-IN'
            ? 'फिंगरप्रिंट रजिस्टर हो गया! अब आप लॉगिन हैं।'
            : 'Passkey registered successfully! You are now logged in.';
        speak(successMsg, { lang });
      }
    } catch (err) {
      triggerHaptic('error');
      setAuthError((err as Error).message);
    } finally {
      setIsPasskeyLoading(false);
    }
  };

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
      const approvalPending = outcome.status === 'need_guardian_approval';
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
          : `${lang === 'hi-IN' ? 'PayPal Sandbox payment fail hua. Aapka reserved paisa wallet mein wapas aa gaya.' : 'The PayPal Sandbox payment failed. Any reserved amount was returned to your wallet.'} ${statusMessage}`;
      speak(spokenStatus.trim(), { lang });
    } catch (err) {
      triggerHaptic('error');
      setPendingConfirmation((prev) => ({
        ...prev,
        isProcessing: false,
        isFailed: true,
        statusMessage: (err as Error).message || (lang === 'hi-IN'
          ? 'पेमेंट पूरा नहीं हो सका। पैसा वापस जोड़ दिया गया है।'
          : 'Payment did not complete. Any reserved amount was returned to your wallet.'),
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

      if (res.ok) {
        const inv = await res.json();
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
        const message = lang === 'hi-IN'
          ? 'Yeh QR code supported PayPal invoice ya recipient code nahi hai. Payee ka Awaaz Pay QR scan karein.'
          : 'This QR code is not a supported PayPal invoice or recipient code. Ask the payee for an Awaaz Pay recipient QR.';
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
          setPendingConfirmation((prev) => ({
            ...prev,
            isPending: false,
            isFailed: true,
            statusMessage: 'PayPal did not complete the payout. The reserved wallet amount was returned.',
          }));
          speak(lang === 'hi-IN'
            ? 'PayPal ne payment fail kiya. Rakam wallet mein wapas aa gayi.'
            : 'PayPal failed the payout. The reserved amount was returned to your wallet.', { lang });
          stopped = true;
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
        : lang === 'hi-IN' ? 'तैयार' : 'Ready';

  // Subpage routes
  if (currentRoute.path === 'approve' && currentRoute.token) {
    return <GuardianApprovePage token={currentRoute.token} />;
  }
  if (currentRoute.path === 'onboarding') {
    return <OnboardingWizard />;
  }
  if (currentRoute.path === 'merchant') {
    return <MerchantDemoPage />;
  }
  if (currentRoute.path === 'family') {
    return <FamilyDashboardPage />;
  }
  if (currentRoute.path === 'design-preview') {
    return <DesignPreviewPage />;
  }
  if (currentRoute.path === 'activity') {
    return <ActivityScreen onBack={() => setCurrentRoute({ path: 'wallet' })} speak={speak} lang={lang} />;
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
        onConfirm={handleExecutePayment}
        onCancel={() => setPendingConfirmation({ isOpen: false, payeeName: '', amount: 0 })}
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
              onClick={() => setIsSettingsOpen(true)}
              style={{
                minHeight: '48px',
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-pill)',
                border: '2px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              aria-label="Open settings"
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

          {/* Repeat Button (Full-width pill, min 64px) */}
          <BigButton
            variant="secondary"
            onClick={repeatLastReply}
            aria-label={lang === 'hi-IN' ? 'पिछला जवाब दोहराएं' : 'Repeat last reply'}
          >
            🔁 {lang === 'hi-IN' ? 'दोहराओ (Repeat)' : 'Repeat'}
          </BigButton>

          {/* Bottom link row: Scan a QR code, Activity, Family */}
          <nav
            aria-label="Secondary actions"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.5rem',
              width: '100%',
              marginTop: '0.5rem',
            }}
          >
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              style={{
                minHeight: 'var(--min-target, 64px)',
                borderRadius: 'var(--radius-pill)',
                border: '2px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              📷 {lang === 'hi-IN' ? 'QR स्कैन' : 'Scan QR'}
            </button>

            <button
              type="button"
              onClick={() => setCurrentRoute({ path: 'activity' })}
              style={{
                minHeight: 'var(--min-target, 64px)',
                borderRadius: 'var(--radius-pill)',
                border: '2px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              📜 {lang === 'hi-IN' ? 'हिसाब' : 'Activity'}
            </button>

            <a
              href="/family"
              style={{
                minHeight: 'var(--min-target, 64px)',
                borderRadius: 'var(--radius-pill)',
                border: '2px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                fontWeight: 700,
                fontSize: '1rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
              }}
            >
              🛡️ {lang === 'hi-IN' ? 'परिवार' : 'Family'}
            </a>
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

      {/* Unauthenticated Security Gate */}
      {authState === 'unauthenticated' && (
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
          aria-label="Fingerprint passkey login"
        >
          <Headline level={2}>
            {lang === 'hi-IN' ? 'सुरक्षा लॉक (Passkey)' : 'Security Lock (Passkey)'}
          </Headline>
          <BodyText muted>
            {lang === 'hi-IN'
              ? 'आवाज़ पे का उपयोग करने के लिए अपनी उंगली सेंसर पर रखें।'
              : 'Please place your finger on the sensor to log in.'}
          </BodyText>
          <BigButton
            variant="primary"
            onClick={handlePasskeyLogin}
            disabled={isPasskeyLoading}
            loading={isPasskeyLoading}
            loadingText="Verifying passkey..."
          >
            👆 {lang === 'hi-IN' ? 'फिंगरप्रिंट से लॉगिन करें' : 'Login with Fingerprint'}
          </BigButton>
          <BigButton
            variant="secondary"
            onClick={handlePasskeyRegister}
            disabled={isPasskeyLoading}
          >
            ➕ {lang === 'hi-IN' ? 'नया फिंगरप्रिंट जोड़ें' : 'Register New Passkey'}
          </BigButton>
          {authError && <StatusBanner variant="danger" label="Error">{authError}</StatusBanner>}
        </section>
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
          <StatusBanner variant={micPermissionReady && micPermissionError ? 'success' : 'danger'} label={micPermissionReady && micPermissionError ? 'Ready' : 'Error'}>
            {error || scanError || micPermissionError}
          </StatusBanner>
        )}

        {/* Fallback Text Input & Type Option */}
        <form
          onSubmit={handleTextSubmit}
          style={{
            display: 'flex',
            gap: '0.5rem',
            width: '100%',
            maxWidth: '520px',
            marginTop: '1rem',
          }}
          aria-label="Text message input"
        >
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              lang === 'hi-IN'
                ? 'या यहाँ टाइप करें (उदा. रमेश को 500 भेजो)'
                : 'Or type here (e.g. Send 500 to Ramesh)'
            }
            aria-label={lang === 'hi-IN' ? 'आदेश यहाँ टाइप करें' : 'Type voice command text'}
            style={{
              flex: 1,
              minHeight: '48px',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-pill)',
              border: '2px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '1rem',
            }}
          />
          <button
            type="submit"
            style={{
              minHeight: '48px',
              padding: '0.75rem 1.25rem',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-text)',
              border: 'none',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            {lang === 'hi-IN' ? 'भेजें' : 'Send'}
          </button>
        </form>
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
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
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
              backgroundColor: 'var(--bg)',
              color: 'var(--text)',
              borderRadius: 'var(--radius-card, 16px)',
              padding: '2rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
              border: '2px solid var(--border)',
            }}
          >
            <Headline level={2}>{lang === 'hi-IN' ? 'सेटिंग्स' : 'App Settings'}</Headline>

            {/* Output Mode Selection */}
            <div>
              <strong style={{ fontSize: 'var(--text-body-large)', display: 'block', marginBottom: '0.5rem' }}>
                {lang === 'hi-IN' ? 'आवाज़ मोड चुनें:' : 'Speech Output Mode:'}
              </strong>
              <BodyText muted style={{ marginBottom: '1rem' }}>
                {outputMode === 'voice'
                  ? 'Voice Mode: The app speaks replies itself using its built-in speech engine.'
                  : 'Screen Reader Mode: The app does not speak aloud; TalkBack or VoiceOver will read the text to prevent double speech.'}
              </BodyText>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <BigButton
                  variant={outputMode === 'voice' ? 'primary' : 'secondary'}
                  onClick={() => setOutputMode('voice')}
                >
                  🎙️ Voice Mode
                </BigButton>
                <BigButton
                  variant={outputMode === 'screen_reader' ? 'primary' : 'secondary'}
                  onClick={() => setOutputMode('screen_reader')}
                >
                  ♿ Screen Reader
                </BigButton>
              </div>
            </div>

            {/* Language Selection */}
            <div>
              <strong style={{ fontSize: 'var(--text-body-large)', display: 'block', marginBottom: '0.5rem' }}>
                {lang === 'hi-IN' ? 'भाषा (Language):' : 'Language:'}
              </strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <BigButton
                  variant={lang === 'hi-IN' ? 'primary' : 'secondary'}
                  onClick={() => setLang('hi-IN')}
                >
                  हिंदी (Hindi)
                </BigButton>
                <BigButton
                  variant={lang === 'en-IN' ? 'primary' : 'secondary'}
                  onClick={() => setLang('en-IN')}
                >
                  English
                </BigButton>
              </div>
            </div>

            {/* Hands-Free Continuous Voice Toggle */}
            <div>
              <strong style={{ fontSize: 'var(--text-body-large)', display: 'block', marginBottom: '0.5rem' }}>
                {lang === 'hi-IN' ? 'हैंड्स-फ्री वॉइस (ऑटो-माइक):' : 'Hands-Free Voice (Auto-Mic):'}
              </strong>
              <BodyText muted style={{ marginBottom: '1rem' }}>
                {isContinuousVoice
                  ? 'Active: The mic automatically re-opens after the assistant speaks so blind users can converse hands-free.'
                  : 'Manual: Tap the mic each time you want to speak.'}
              </BodyText>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <BigButton
                  variant={isContinuousVoice ? 'primary' : 'secondary'}
                  onClick={() => setIsContinuousVoice(true)}
                >
                  🟢 Hands-Free ON
                </BigButton>
                <BigButton
                  variant={!isContinuousVoice ? 'primary' : 'secondary'}
                  onClick={() => setIsContinuousVoice(false)}
                >
                  ⚪ Manual Tap
                </BigButton>
              </div>
            </div>

            {/* Speech Speed */}
            <div>
              <strong style={{ fontSize: 'var(--text-body-large)', display: 'block', marginBottom: '0.5rem' }}>
                {lang === 'hi-IN' ? 'बोलने की गति:' : 'Speech Speed:'}
              </strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setSpeed(0.8)}
                  style={{
                    minHeight: '48px',
                    borderRadius: 'var(--radius-pill)',
                    backgroundColor: speed === 0.8 ? 'var(--accent)' : 'var(--surface)',
                    color: speed === 0.8 ? 'var(--accent-text)' : 'var(--text)',
                    border: '2px solid var(--border)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  0.8x (Slow)
                </button>
                <button
                  type="button"
                  onClick={() => setSpeed(1.0)}
                  style={{
                    minHeight: '48px',
                    borderRadius: 'var(--radius-pill)',
                    backgroundColor: speed === 1.0 ? 'var(--accent)' : 'var(--surface)',
                    color: speed === 1.0 ? 'var(--accent-text)' : 'var(--text)',
                    border: '2px solid var(--border)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  1.0x (Normal)
                </button>
                <button
                  type="button"
                  onClick={() => setSpeed(1.2)}
                  style={{
                    minHeight: '48px',
                    borderRadius: 'var(--radius-pill)',
                    backgroundColor: speed === 1.2 ? 'var(--accent)' : 'var(--surface)',
                    color: speed === 1.2 ? 'var(--accent-text)' : 'var(--text)',
                    border: '2px solid var(--border)',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  1.2x (Fast)
                </button>
              </div>
            </div>

            <BigButton variant="primary" onClick={() => setIsSettingsOpen(false)}>
              {lang === 'hi-IN' ? 'सेव करें और बंद करें' : 'Save & Close'}
            </BigButton>
          </div>
        </div>
      )}
    </Page>
  );
};

export default App;
