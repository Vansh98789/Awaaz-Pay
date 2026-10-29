import React, { useEffect, useRef, useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { GuardianApprovePage } from './pages/GuardianApprovePage';
import { OnboardingWizard } from './pages/OnboardingWizard';
import { MerchantDemoPage } from './pages/MerchantDemoPage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage';
import { QRScannerModal } from './components/QRScannerModal';

interface TranscriptEntry {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  time: string;
}

interface VoiceChallengeState {
  isOpen: boolean;
  challengeId?: string;
  phrase?: string;
  instruction?: string;
  result?: {
    passed: boolean;
    score: number;
    message: string;
  };
}

export const App: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<{
    path: 'wallet' | 'approve' | 'onboarding' | 'merchant' | 'family';
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
    if (path === '/onboarding' || hash === '#/onboarding' || hash === '#onboarding') {
      return { path: 'onboarding' };
    }
    if (path === '/merchant' || hash === '#/merchant' || hash === '#merchant') {
      return { path: 'merchant' };
    }
    if (path === '/family' || hash === '#/family' || hash === '#family') {
      return { path: 'family' };
    }
    return { path: 'wallet' };
  });

  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const [authState, setAuthState] = useState<'checking' | 'unauthenticated' | 'authenticated'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [voiceChallenge, setVoiceChallenge] = useState<VoiceChallengeState>({ isOpen: false });
  const [pendingApprovalTxId, setPendingApprovalTxId] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [isSlowNetwork, setIsSlowNetwork] = useState(false);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path.startsWith('/approve/')) {
        setCurrentRoute({ path: 'approve', token: path.replace('/approve/', '').replace(/^\//, '') });
      } else if (hash.startsWith('#/approve/') || hash.startsWith('#approve/')) {
        setCurrentRoute({ path: 'approve', token: hash.replace(/^#(|\/)approve\//, '') });
      } else if (path === '/onboarding' || hash === '#/onboarding' || hash === '#onboarding') {
        setCurrentRoute({ path: 'onboarding' });
      } else if (path === '/merchant' || hash === '#/merchant' || hash === '#merchant') {
        setCurrentRoute({ path: 'merchant' });
      } else if (path === '/family' || hash === '#/family' || hash === '#family') {
        setCurrentRoute({ path: 'family' });
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

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sess-${Date.now()}`
  );

  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text:
        lang === 'hi-IN'
          ? 'Namaste Meena ji. Boliye, main sun rahi hoon.'
          : 'Hello Meena. Tap the mic and speak, I am listening.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const { speak, stop, repeatLastReply, isSpeaking, speed, setSpeed } =
    useSpeechSynthesis({
      defaultLang: lang,
      defaultSpeed: 1.0,
    });

  // Check auth status on mount
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

  // Online / Offline and Network Accessibility Listener
  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      const offlineMsg =
        lang === 'hi-IN'
          ? 'Internet connection chala gaya hai. Kripya apna network check karein.'
          : 'Internet connection lost. Please check your network connection.';
      speak(offlineMsg, { lang });
    };

    const handleOnline = () => {
      setIsOffline(false);
      const onlineMsg =
        lang === 'hi-IN'
          ? 'Internet connection vapas jud gaya hai.'
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

  // Poll for guardian approval when transaction is waiting
  useEffect(() => {
    if (!pendingApprovalTxId) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/approvals/status/${pendingApprovalTxId}`);
        if (!res.ok) return;
        const info = await res.json();
        if (!isMounted) return;

        if (info.approvalStatus === 'approved') {
          clearInterval(interval);
          setPendingApprovalTxId(null);
          const approvedMsg =
            lang === 'hi-IN'
              ? 'Ramesh ji ne payment ki manzoori de di hai. Payment bhejne ke liye "haan" bolein.'
              : 'Guardian has approved this payment. Say "yes" to complete.';
          speak(approvedMsg, { lang });
          setTranscripts((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              sender: 'assistant',
              text: approvedMsg,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        } else if (info.approvalStatus === 'denied') {
          clearInterval(interval);
          setPendingApprovalTxId(null);
          const deniedMsg =
            lang === 'hi-IN'
              ? 'Ramesh ji ne payment reject kar diya hai. Payment cancel ho gaya hai.'
              : 'Guardian has denied this payment. Payment has been cancelled.';
          speak(deniedMsg, { lang });
          setTranscripts((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              sender: 'assistant',
              text: deniedMsg,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      } catch {
        // Ignored
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [pendingApprovalTxId, lang, speak]);

  // Passkey Login Flow
  const handlePasskeyLogin = async () => {
    try {
      setIsPasskeyLoading(true);
      setAuthError(null);

      // Spoken guidance
      const guidance =
        lang === 'hi-IN'
          ? 'Apni ungli sensor par rakhein.'
          : 'Please place your finger on the sensor.';
      speak(guidance, { lang });

      const optRes = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena' }),
        credentials: 'include',
      });

      if (!optRes.ok) {
        throw new Error('Failed to fetch login options');
      }

      const options = await optRes.json();
      const authResp = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena', response: authResp }),
        credentials: 'include',
      });

      if (!verifyRes.ok) {
        throw new Error('Verification failed');
      }

      const verifyData = await verifyRes.json();
      if (verifyData.verified) {
        setAuthState('authenticated');
        const successMsg =
          lang === 'hi-IN'
            ? 'Login safal raha! Boliye, main sun rahi hoon.'
            : 'Login successful! Speak, I am listening.';
        speak(successMsg, { lang });
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      setAuthError(errMsg);
      const spokenErr =
        lang === 'hi-IN'
          ? 'Login nahi ho paya. Dobara koshish karein.'
          : 'Fingerprint login failed. Please try again.';
      speak(spokenErr, { lang });
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // Passkey Registration Flow
  const handlePasskeyRegister = async () => {
    try {
      setIsPasskeyLoading(true);
      setAuthError(null);

      const guidance =
        lang === 'hi-IN'
          ? 'Naya fingerprint jodne ke liye ungli sensor par rakhein.'
          : 'Place your finger on the sensor to register passkey.';
      speak(guidance, { lang });

      const optRes = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena' }),
        credentials: 'include',
      });

      if (!optRes.ok) {
        throw new Error('Failed to fetch registration options');
      }

      const options = await optRes.json();
      const regResp = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user_meena', response: regResp }),
        credentials: 'include',
      });

      if (!verifyRes.ok) {
        throw new Error('Registration verification failed');
      }

      const verifyData = await verifyRes.json();
      if (verifyData.verified) {
        setAuthState('authenticated');
        const successMsg =
          lang === 'hi-IN'
            ? 'Fingerprint safal register ho gaya! Ab aap login hain.'
            : 'Passkey registered successfully! You are now logged in.';
        speak(successMsg, { lang });
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      setAuthError(errMsg);
      const spokenErr =
        lang === 'hi-IN'
          ? 'Fingerprint register nahi ho saka.'
          : 'Failed to register fingerprint.';
      speak(spokenErr, { lang });
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      setAuthState('unauthenticated');
      const logoutMsg =
        lang === 'hi-IN' ? 'Aap logout ho gaye hain.' : 'You have been logged out.';
      speak(logoutMsg, { lang });
    } catch {
      setAuthState('unauthenticated');
    }
  };

  // Voice Challenge Flow
  const startVoiceChallenge = async () => {
    try {
      const res = await fetch('/api/auth/voice-challenge');
      const data = await res.json();
      setVoiceChallenge({
        isOpen: true,
        challengeId: data.id,
        phrase: data.phrase,
        instruction: data.instructionHindi,
      });

      const promptMsg =
        lang === 'hi-IN'
          ? `Voice challenge ke liye, kripya yeh dohraiye: "${data.phrase}"`
          : `For voice challenge, please say: "${data.phrase}"`;
      speak(promptMsg, { lang });
    } catch {
      // Ignored
    }
  };

  const handleSpeechResult = async (text: string) => {
    const nowTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userEntry: TranscriptEntry = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text,
      time: nowTime,
    };

    setTranscripts((prev) => [...prev, userEntry]);

    // Offline accessibility check
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineMsg =
        lang === 'hi-IN'
          ? 'Aap offline hain. Kripya apna internet connection check karein.'
          : 'You are offline. Please check your internet connection.';
      speak(offlineMsg, { lang });
      setTranscripts((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          sender: 'assistant',
          text: offlineMsg,
          time: nowTime,
        },
      ]);
      return;
    }

    // Slow network detection timer (4 seconds)
    let slowTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      setIsSlowNetwork(true);
      const slowMsg =
        lang === 'hi-IN'
          ? 'Network thoda dheema hai, kripya intezar karein...'
          : 'Network is slow, please hold on...';
      speak(slowMsg, { lang });
    }, 4000);

    // If active voice challenge is running, verify it
    if (voiceChallenge.isOpen && voiceChallenge.challengeId) {
      if (slowTimer) clearTimeout(slowTimer);
      setIsSlowNetwork(false);
      try {
        const verifyRes = await fetch('/api/auth/voice-challenge/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId: voiceChallenge.challengeId,
            transcript: text,
            userId: 'user_meena',
          }),
        });
        const vResult = await verifyRes.json();
        setVoiceChallenge((prev) => ({
          ...prev,
          result: {
            passed: vResult.passed,
            score: Math.round(vResult.score * 100),
            message: vResult.passed
              ? 'Voice match successful! (Secondary risk signal)'
              : 'Voice did not match phrase (recorded as risk signal only).',
          },
        }));

        const resultSpoken = vResult.passed
          ? 'Awaaz match ho gayi.'
          : 'Awaaz puri tarah match nahi hui, secondary risk ke roop mein record kiya gaya.';
        speak(resultSpoken, { lang });
        return;
      } catch {
        // Fall through
      }
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

      if (res.status === 401) {
        setAuthState('unauthenticated');
        const unauthMsg =
          lang === 'hi-IN'
            ? 'Suraksha ke liye pehle fingerprint se login karein.'
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
        actions?: { transactionId?: string };
      };

      if (data.state === 'awaiting_guardian_approval' && data.actions?.transactionId) {
        setPendingApprovalTxId(data.actions.transactionId);
      }

      const replyLangCode = data.replyLanguage === 'en' ? 'en-IN' : 'hi-IN';

      const assistantEntry: TranscriptEntry = {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: data.replyText,
        time: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      setTranscripts((prev) => [...prev, assistantEntry]);
      speak(data.replyText, { lang: replyLangCode });
    } catch (err) {
      if (slowTimer) clearTimeout(slowTimer);
      setIsSlowNetwork(false);

      const isNetworkErr =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        (err as Error).message?.includes('fetch') ||
        (err as Error).message?.includes('Network');

      const spokenError = isNetworkErr
        ? lang === 'hi-IN'
          ? 'Network error: Server se sampark nahi ho saka. Kripya apna connection check karein.'
          : 'Network error: Unable to reach the server. Please check your connection.'
        : lang === 'hi-IN'
          ? 'Kshama karein, ek samasya aayi hai. Dobara koshish karein.'
          : 'Sorry, an error occurred. Please try again.';

      speak(spokenError, { lang });

      const assistantEntry: TranscriptEntry = {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: spokenError,
        time: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      setTranscripts((prev) => [...prev, assistantEntry]);
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
      setIsSlowNetwork(false);
    }
  };

  const handleSpeechError = (_code: string, friendlyMsg: string) => {
    speak(friendlyMsg, { lang });
  };

  const { isListening, isSupported: sttSupported, toggleListening, error } =
    useSpeechRecognition({
      lang,
      onResult: handleSpeechResult,
      onError: handleSpeechError,
    });

  const toggleLanguage = () => {
    const nextLang = lang === 'hi-IN' ? 'en-IN' : 'hi-IN';
    setLang(nextLang);
    const switchMsg =
      nextLang === 'hi-IN'
        ? 'Bhasha Hindi chuni gayi.'
        : 'Language switched to English.';
    speak(switchMsg, { lang: nextLang });
  };

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

  const handleScanSuccess = (qrData: string) => {
    setIsScannerOpen(false);
    handleSpeechResult(qrData);
  };

  return (
    <div className="app-container">
      <a href="#main-content" className="skip-link">
        {lang === 'hi-IN' ? 'Mukhya vishay par jayein' : 'Skip to main content'}
      </a>

      {isOffline && (
        <div className="offline-banner" role="alert" aria-live="assertive">
          <span>📡</span>
          <span>
            {lang === 'hi-IN'
              ? 'Aap offline hain — Internet connection nahi hai'
              : 'You are offline — No internet connection'}
          </span>
        </div>
      )}

      {isSlowNetwork && (
        <div className="slow-network-banner" role="alert" aria-live="polite">
          <span>⏳</span>
          <span>
            {lang === 'hi-IN'
              ? 'Network thoda dheema chal raha hai, kripya intezar karein...'
              : 'Slow network detected, processing request...'}
          </span>
        </div>
      )}

      <header className="app-header">
        <h1 className="app-title">Awaaz Pay</h1>
        <div className="header-controls">
          <a
            href="/family"
            className="action-pill-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            aria-label="Open family activity dashboard"
          >
            🛡️ Family
          </a>
          <a
            href="/merchant"
            className="action-pill-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            aria-label="Open Ravi Cabs merchant portal"
          >
            🚖 Merchant
          </a>
          <a
            href="/onboarding"
            className="action-pill-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            aria-label="Open assisted onboarding wizard"
          >
            👥 Onboarding
          </a>
          {authState === 'authenticated' && (
            <button
              type="button"
              className="action-pill-btn logout-pill"
              onClick={handleLogout}
              aria-label="Logout"
            >
              🔒 Logout
            </button>
          )}
          <button
            type="button"
            className="lang-toggle-btn"
            onClick={toggleLanguage}
            aria-label={`Change language. Currently ${lang === 'hi-IN' ? 'Hindi' : 'English'}`}
          >
            {lang === 'hi-IN' ? '🌐 English' : '🌐 हिंदी'}
          </button>
        </div>
      </header>

      {/* Auth Gate for unauthenticated state */}
      {authState === 'unauthenticated' && (
        <section className="auth-card" aria-label="Fingerprint passkey login">
          <div className="auth-icon-wrapper" aria-hidden="true">
            🔐
          </div>
          <h2 className="auth-heading">
            {lang === 'hi-IN' ? 'Suraksha Lock (Passkey)' : 'Security Lock (Passkey)'}
          </h2>
          <p className="auth-description">
            {lang === 'hi-IN'
              ? 'Awaaz Pay use karne ke liye apni ungli sensor par rakhein.'
              : 'Please place your finger on the sensor to log in with your passkey.'}
          </p>

          <div className="auth-button-group">
            <button
              type="button"
              className="auth-primary-btn"
              onClick={handlePasskeyLogin}
              disabled={isPasskeyLoading}
              aria-label={lang === 'hi-IN' ? 'Fingerprint se login karein' : 'Login with fingerprint'}
            >
              👆 {isPasskeyLoading ? 'Verifying...' : lang === 'hi-IN' ? 'Fingerprint se Login' : 'Login with Passkey'}
            </button>

            <button
              type="button"
              className="auth-secondary-btn"
              onClick={handlePasskeyRegister}
              disabled={isPasskeyLoading}
              aria-label={lang === 'hi-IN' ? 'Naya fingerprint jodein' : 'Register new passkey'}
            >
              ➕ {lang === 'hi-IN' ? 'Naya Fingerprint Jodein' : 'Register Fingerprint'}
            </button>
          </div>

          {authError && (
            <p className="error-banner" role="alert">
              ⚠️ {authError}
            </p>
          )}
        </section>
      )}

      {/* Voice Challenge Box */}
      {voiceChallenge.isOpen && (
        <section className="voice-challenge-card" role="dialog" aria-label="Voice Challenge">
          <div className="voice-challenge-header">
            <h3>🎙️ {lang === 'hi-IN' ? 'Voice Challenge (Risk Signal)' : 'Voice Challenge'}</h3>
            <button
              type="button"
              className="close-challenge-btn"
              onClick={() => setVoiceChallenge({ isOpen: false })}
              aria-label="Close voice challenge"
            >
              ✕
            </button>
          </div>
          <p className="challenge-prompt">
            <strong>{voiceChallenge.phrase}</strong>
          </p>
          <p className="challenge-hint">
            {lang === 'hi-IN'
              ? 'Mic dabakar upar diya gaya vakya bolein.'
              : 'Tap mic and speak the phrase above.'}
          </p>
          <p className="challenge-notice">
            ℹ️ <em>Voice is a secondary risk signal only, not a hard lock.</em>
          </p>
          {voiceChallenge.result && (
            <div className={`challenge-result ${voiceChallenge.result.passed ? 'pass' : 'fail'}`}>
              <strong>{voiceChallenge.result.passed ? '✅ Passed' : '⚠️ Risk Flagged'}</strong> ({voiceChallenge.result.score}% match)
              <p>{voiceChallenge.result.message}</p>
            </div>
          )}
        </section>
      )}

      <div
        className="status-bar"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isListening ? (
          <span className="status-badge listening">
            🔴 {lang === 'hi-IN' ? 'Sun rahi hoon... Boliye' : 'Listening... Speak now'}
          </span>
        ) : isSpeaking ? (
          <span className="status-badge speaking">
            🔊 {lang === 'hi-IN' ? 'Bol rahi hoon...' : 'Speaking...'}
          </span>
        ) : (
          <span className="status-badge idle">
            {lang === 'hi-IN' ? 'Taiyaar — Mic dabaiye' : 'Ready — Tap mic to talk'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
        <button
          type="button"
          className="action-pill-btn"
          onClick={() => setIsScannerOpen(true)}
          style={{
            padding: '0.55rem 1.15rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--accent-cyan)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            borderRadius: '9999px',
          }}
          aria-label="Scan PayPal Invoice QR Code with Camera"
        >
          📷 {lang === 'hi-IN' ? 'Invoice QR Scan Karein' : 'Scan Invoice QR'}
        </button>
      </div>

      <main id="main-content" className="mic-hero-section">
        {!sttSupported ? (
          <div className="unsupported-warning" role="alert">
            <p>
              {lang === 'hi-IN'
                ? 'Aapke browser mein Speech Recognition support nahi hai. Chrome ya Edge use karein.'
                : 'Web Speech API is not supported in this browser. Please use Chrome or Edge.'}
            </p>
          </div>
        ) : (
          <button
            type="button"
            className={`giant-mic-button ${isListening ? 'active' : ''} ${isSpeaking ? 'speaking-active' : ''}`}
            onClick={toggleListening}
            aria-label={
              isListening
                ? lang === 'hi-IN'
                  ? 'Sunna band karein'
                  : 'Stop listening'
                : lang === 'hi-IN'
                  ? 'Bolne ke liye yahan dabayein'
                  : 'Tap to speak'
            }
          >
            <div className="mic-icon-wrapper">
              <svg
                className="mic-svg"
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
            </div>
            <span className="mic-hint-text">
              {isListening
                ? lang === 'hi-IN'
                  ? 'Rukne ke liye dabayein'
                  : 'Tap to Stop'
                : lang === 'hi-IN'
                  ? 'Bolne ke liye dabayein'
                  : 'Tap to Speak'}
            </span>
          </button>
        )}

        {error && (
          <p className="error-banner" role="alert">
            ⚠️ {error}
          </p>
        )}
      </main>

      <section className="audio-actions-bar" aria-label="Audio controls">
        <button
          type="button"
          className="action-pill-btn repeat-btn"
          onClick={repeatLastReply}
          aria-label={lang === 'hi-IN' ? 'Pichla jawab dohrao' : 'Repeat last reply'}
        >
          🔁 {lang === 'hi-IN' ? 'Dohrao' : 'Repeat'}
        </button>

        <button
          type="button"
          className="action-pill-btn stop-btn"
          onClick={stop}
          disabled={!isSpeaking}
          aria-label={lang === 'hi-IN' ? 'Awaaz roko' : 'Stop audio'}
        >
          ⏹ {lang === 'hi-IN' ? 'Ruko' : 'Stop'}
        </button>

        <button
          type="button"
          className="action-pill-btn voice-challenge-pill"
          onClick={startVoiceChallenge}
          aria-label={lang === 'hi-IN' ? 'Voice challenge shuru karein' : 'Start voice challenge'}
        >
          🎙️ {lang === 'hi-IN' ? 'Voice Challenge' : 'Voice Signal'}
        </button>

        <div className="speed-selector" aria-label="Speech speed">
          <button
            type="button"
            className={`speed-chip ${speed === 0.8 ? 'selected' : ''}`}
            onClick={() => setSpeed(0.8)}
            aria-label="Slow speech 0.8x"
          >
            0.8x
          </button>
          <button
            type="button"
            className={`speed-chip ${speed === 1.0 ? 'selected' : ''}`}
            onClick={() => setSpeed(1.0)}
            aria-label="Normal speech 1.0x"
          >
            1.0x
          </button>
          <button
            type="button"
            className={`speed-chip ${speed === 1.2 ? 'selected' : ''}`}
            onClick={() => setSpeed(1.2)}
            aria-label="Fast speech 1.2x"
          >
            1.2x
          </button>
        </div>
      </section>

      <section
        className="transcript-region"
        role="region"
        aria-live="polite"
        aria-label="Transcript of conversation"
      >
        <h2 className="transcript-heading">
          {lang === 'hi-IN' ? 'Baat-cheet (Transcript)' : 'Conversation Transcript'}
        </h2>
        <div className="transcript-scroll">
          {transcripts.map((entry) => (
            <div
              key={entry.id}
              className={`transcript-bubble ${entry.sender}`}
            >
              <div className="bubble-header">
                <span className="bubble-sender">
                  {entry.sender === 'user'
                    ? lang === 'hi-IN'
                      ? 'Aap (User)'
                      : 'You'
                    : 'Awaaz Pay'}
                </span>
                <span className="bubble-time">{entry.time}</span>
              </div>
              <p className="bubble-text">{entry.text}</p>
            </div>
          ))}
        </div>
      </section>

      <QRScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
        speak={speak}
        lang={lang}
      />
    </div>
  );
};

export default App;
