import React, { FormEvent, useEffect, useState } from 'react';

interface FamilyGateProps {
  children: React.ReactNode;
  onExit?: () => void;
}

export const FamilyGate: React.FC<FamilyGateProps> = ({ children, onExit }) => {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/family/session', { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : { authenticated: false })
      .then((data) => { if (active) setAuthenticated(Boolean(data.authenticated)); })
      .catch(() => { if (active) setError('Could not connect to Awaaz Pay. Please try again.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/family/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not sign in.');
      setAuthenticated(true);
      setPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    await fetch('/api/family/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    setAuthenticated(false);
    setPassword('');
    onExit?.();
  };

  if (checking) {
    return <main className="family-login-page" aria-live="polite"><p>Checking family portal session…</p></main>;
  }

  if (authenticated) {
    return <>{React.cloneElement(children as React.ReactElement<{ onLogout?: () => void }>, { onLogout: logout })}</>;
  }

  return (
    <main className="family-login-page">
      <section className="family-login-card" aria-labelledby="family-login-title">
        <p className="family-login-eyebrow">Awaaz Pay · Guardian access</p>
        <h1 id="family-login-title">Family portal</h1>
        <p className="family-login-copy">Sign in with the family login configured for this Awaaz Pay app. This is separate from PayPal.</p>
        <form onSubmit={login}>
          <label htmlFor="family-email">Family email</label>
          <input
            id="family-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="family-password">Password</label>
          <input
            id="family-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <p className="family-login-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in to family portal'}
          </button>
        </form>
        <button className="family-login-back" type="button" onClick={onExit ?? (() => { window.location.href = '/'; })}>
          Return to voice wallet
        </button>
      </section>
    </main>
  );
};
