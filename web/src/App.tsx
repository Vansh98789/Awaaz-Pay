import React, { useEffect, useRef, useState } from 'react';
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

  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [isThinking, setIsThinking] = useState(false);

  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmationState>({
    isOpen: false,
    payeeName: '',
    amount: 0,
  });

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `sess-${Date.now()}`
  );

  const { speak, repeatLastReply, isSpeaking, speed, setSpeed, outputMode, setOutputMode } =
    useSpeechSynthesis({
      defaultLang: lang,
      defaultSpeed: 1.0,
    });

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text:
        lang === 'hi-IN'
          ? 'नमस्ते। बोलिए, मैं सुन रही हूँ।'
          : 'Say it. Hear it. Pay safely. Tap the mic to talk.',
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

    // Handle voice answers to confirmation screen if open
    if (pendingConfirmation.isOpen) {
      const lower = text.toLowerCase();
      if (lower.includes('haan') || lower.includes('yes') || lower.includes('kar do') || lower.includes('theek')) {
        handleExecutePayment();
        return;
      }
      if (lower.includes('nahi') || lower.includes('no') || lower.includes('cancel') || lower.includes('mat')) {
        setPendingConfirmation({ isOpen: false, payeeName: '', amount: 0 });
        const cancelMsg = lang === 'hi-IN' ? 'Payment cancel kar diya gaya.' : 'Payment cancelled.';
        speak(cancelMsg, { lang });
        setIsThinking(false);
        return;
      }
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
      };

      // Detect Blocked payment state
      if (data.state === 'idle' && (data.replyText.includes('scam') || data.replyText.includes('rok') || data.replyText.includes('blocked'))) {
        triggerHaptic('blocked');
      }

      // Check if server asks for confirmation
      if (data.state === 'awaiting_confirmation' && data.context?.pendingPayeeName && data.context?.pendingAmount) {
        setPendingConfirmation({
          isOpen: true,
          payeeName: data.context.pendingPayeeName,
          amount: data.context.pendingAmount,
          contextSentence: lang === 'hi-IN' ? 'एक सुरक्षित कांटेक्ट को।' : 'To a verified recipient.',
        });
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
        lang === 'hi-IN' ? `आपने कहा: "${text}".` : `You said: "${text}".`;

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

  const handleSpeechError = (_code: string, friendlyMsg: string) => {
    setIsThinking(false);
    triggerHaptic('error');
    speak(friendlyMsg, { lang });
  };

  const { isListening, isSupported: sttSupported, toggleListening, error } =
    useSpeechRecognition({
      lang,
      onResult: handleSpeechResult,
      onError: handleSpeechError,
    });

  // Handle start listening haptics
  const handleMicClick = () => {
    if (!isListening) {
      triggerHaptic('listeningStart');
    }
    toggleListening();
  };

  // Keyboard accessibility: Space or Enter starts and stops listening
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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

      const res = await fetch('/api/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          text: 'Haan',
          userId: 'user_meena',
        }),
      });

      const data = await res.json();
      triggerHaptic('confirmed');

      setPendingConfirmation((prev) => ({
        ...prev,
        isProcessing: false,
        isSuccess: true,
      }));

      speak(data.replyText, { lang });
    } catch {
      triggerHaptic('error');
      setPendingConfirmation((prev) => ({
        ...prev,
        isProcessing: false,
        isBlocked: true,
        blockedReason: 'Payment request failed. Please try again.',
      }));
    }
  };

  const handleScanSuccess = async (qrData: string) => {
    setIsScannerOpen(false);
    triggerHaptic('understood');

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
          contextSentence: lang === 'hi-IN' ? `${inv.merchantName}, एक वेरिफाइड मर्चेंट।` : `To ${inv.merchantName}, a verified merchant.`,
        });
      } else {
        handleSpeechResult(qrData);
      }
    } catch {
      handleSpeechResult(qrData);
    }
  };

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
        onConfirm={handleExecutePayment}
        onCancel={() => setPendingConfirmation({ isOpen: false, payeeName: '', amount: 0 })}
        speak={speak}
        lang={lang}
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

        {error && <StatusBanner variant="danger" label="Error">{error}</StatusBanner>}
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
