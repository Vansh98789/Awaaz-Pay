import React, { useCallback, useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { BodyText, BigButton, DotWordmark, Headline, Page, StatusBanner } from '../design/index.js';

interface AuthStatus {
  passkeyConfigured: boolean;
  registrationAvailable: boolean;
  requiresSetupCode: boolean;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`);
  return data;
}

export const PasskeyGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' });
      if (me.ok) {
        setAuthenticated(true);
        setStatus(null);
        return;
      }
      const response = await fetch('/api/auth/status', { credentials: 'include' });
      const nextStatus = await readJson(response) as unknown as AuthStatus;
      setStatus(nextStatus);
      setAuthenticated(false);
    } catch (err) {
      setError((err as Error).message || 'Could not check your sign-in. Please try again.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void checkSession(); }, [checkSession]);

  const authenticate = async (register: boolean) => {
    setWorking(true);
    setError(null);
    try {
      if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser. Try a recent version of Chrome, Edge, Safari, or Firefox.');

      if (register) {
        const optionsResponse = await fetch('/api/auth/register-options', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_meena', setupCode }),
        });
        const options = await readJson(optionsResponse);
        const credential = await startRegistration({ optionsJSON: options as never });
        const verifyResponse = await fetch('/api/auth/verify-registration', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_meena', response: credential }),
        });
        await readJson(verifyResponse);
      } else {
        const optionsResponse = await fetch('/api/auth/login-options', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_meena' }),
        });
        const options = await readJson(optionsResponse);
        const credential = await startAuthentication({ optionsJSON: options as never });
        const verifyResponse = await fetch('/api/auth/verify-login', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user_meena', response: credential }),
        });
        await readJson(verifyResponse);
      }

      setAuthenticated(true);
      setStatus(null);
    } catch (err) {
      const message = (err as Error).message || '';
      const userMessage = message.includes('NotAllowedError') || message.toLowerCase().includes('cancel')
        ? 'Passkey sign-in was cancelled. Try again when you are ready.'
        : message || 'Passkey sign-in could not be completed. Please try again.';
      await checkSession();
      setError(userMessage);
    } finally {
      setWorking(false);
    }
  };

  if (authenticated) return <>{children}</>;

  if (checking) {
    return <Page lang="en" headerContent={<DotWordmark size={140} />}>
      <div role="status" aria-live="polite"><BodyText size="large">Checking your passkey session…</BodyText></div>
    </Page>;
  }

  const canRegister = status?.registrationAvailable === true;
  return (
    <Page
      lang="en"
      headerContent={<><DotWordmark size={140} /><Headline level={1}>{canRegister ? 'Set up your passkey' : 'Sign in to Awaaz Pay'}</Headline></>}
      footerContent={
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && <StatusBanner variant="danger" label="Sign-in issue">{error}</StatusBanner>}
          {canRegister ? (
            <>
              {status?.requiresSetupCode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label htmlFor="wallet-setup-code">One-time wallet setup code</label>
                  <input
                    id="wallet-setup-code"
                    type="password"
                    autoComplete="one-time-code"
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.target.value)}
                    style={{ minHeight: 64, padding: '0.75rem 1rem', borderRadius: 'var(--radius-card, 12px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }}
                  />
                  <BodyText muted>Enter the code set by the wallet administrator in Render. It is only needed for the first passkey.</BodyText>
                </div>
              )}
              <BigButton
                variant="primary"
                onClick={() => void authenticate(true)}
                loading={working}
                loadingText="Setting up passkey…"
                disabled={status?.requiresSetupCode === true && !setupCode}
              >
                Set up this device
              </BigButton>
            </>
          ) : status?.passkeyConfigured ? (
            <BigButton variant="primary" onClick={() => void authenticate(false)} loading={working} loadingText="Checking passkey…">
              Sign in with passkey
            </BigButton>
          ) : (
            <div role="status" aria-live="polite"><BodyText>No passkey is registered for this wallet. Ask the wallet administrator to complete the first-time setup.</BodyText></div>
          )}
          {error && <BigButton variant="secondary" onClick={() => void checkSession()} disabled={working}>Try again</BigButton>}
        </div>
      }
    >
      <BodyText size="large" style={{ fontWeight: 700 }}>Use your device’s fingerprint, face, or screen lock to access the wallet.</BodyText>
      <BodyText muted style={{ marginTop: '1rem' }}>Your passkey signs you in securely. Payment requests still require a separate spoken confirmation.</BodyText>
    </Page>
  );
};
