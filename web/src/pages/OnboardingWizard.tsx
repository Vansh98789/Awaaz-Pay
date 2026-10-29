import React, { useState } from 'react';

interface ContactInput {
  alias: string;
  displayName: string;
  paypalEmail: string;
}

export const OnboardingWizard: React.FC = () => {
  const [name, setName] = useState('Meena');
  const [language, setLanguage] = useState<'hi' | 'en'>('hi');
  const [dailyTotal, setDailyTotal] = useState(1000);
  const [perPaymentCap, setPerPaymentCap] = useState(500);
  const [guardianName, setGuardianName] = useState('Ramesh');
  const [guardianContact, setGuardianContact] = useState('+971501234567');
  const [contacts, setContacts] = useState<ContactInput[]>([
    { alias: 'bhaiya', displayName: 'Bhaiya', paypalEmail: 'bhaiya-sandbox@example.com' },
  ]);

  const [alias, setAlias] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');

  const [voiceEnrolled, setVoiceEnrolled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addContact = () => {
    if (!alias || !displayName || !paypalEmail) return;
    setContacts((prev) => [...prev, { alias, displayName, paypalEmail }]);
    setAlias('');
    setDisplayName('');
    setPaypalEmail('');
  };

  const removeContact = (index: number) => {
    setContacts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        userId: 'user_meena',
        name,
        language,
        limits: {
          daily_total: Number(dailyTotal),
          per_transaction_new_payee: Number(perPaymentCap),
          max_new_payees_per_day: 2,
        },
        guardian: {
          name: guardianName,
          contact: guardianContact,
          permissions: 'all',
        },
        contacts,
      };

      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="guardian-page-container">
        <div className="guardian-card result-card approved">
          <div className="result-icon">🎉</div>
          <h2>Onboarding Complete!</h2>
          <p>
            {name} is now set up with Awaaz Pay.
          </p>
          <a href="/" className="auth-primary-btn" style={{ textDecoration: 'none', marginTop: '1rem' }}>
            Go to Voice Wallet
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="guardian-page-container">
      <header className="guardian-header">
        <h1>👥 Assisted Onboarding Wizard</h1>
        <p className="guardian-subtitle">Helper & Guardian Setup for Low-Literacy User</p>
      </header>

      <form className="guardian-card onboarding-form" onSubmit={handleSubmit}>
        <section className="form-section">
          <h3>1. User Profile</h3>
          <label>
            User Name:
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="form-input"
            />
          </label>
          <label>
            Primary Language:
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'hi' | 'en')}
              className="form-input"
            >
              <option value="hi">हिंदी (Hindi / Hinglish)</option>
              <option value="en">English</option>
            </select>
          </label>
        </section>

        <section className="form-section">
          <h3>2. Guardian (Helper) Contact</h3>
          <label>
            Guardian Name:
            <input
              type="text"
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
              required
              className="form-input"
            />
          </label>
          <label>
            Guardian Phone / WhatsApp:
            <input
              type="text"
              value={guardianContact}
              onChange={(e) => setGuardianContact(e.target.value)}
              required
              className="form-input"
            />
          </label>
        </section>

        <section className="form-section">
          <h3>3. Spending Caps & Limits</h3>
          <label>
            Daily Spending Limit (₹):
            <input
              type="number"
              value={dailyTotal}
              onChange={(e) => setDailyTotal(Number(e.target.value))}
              required
              className="form-input"
            />
          </label>
          <label>
            Max Per Payment for New Payees (₹):
            <input
              type="number"
              value={perPaymentCap}
              onChange={(e) => setPerPaymentCap(Number(e.target.value))}
              required
              className="form-input"
            />
          </label>
        </section>

        <section className="form-section">
          <h3>4. Trusted Contacts (Spoken Aliases)</h3>
          <div className="contacts-subform">
            <input
              type="text"
              placeholder="Alias (e.g. Bhaiya, Sabzi)"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              className="form-input"
            />
            <input
              type="text"
              placeholder="Display Name (e.g. Ramesh Brother)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="form-input"
            />
            <input
              type="email"
              placeholder="PayPal Sandbox Email"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              className="form-input"
            />
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={addContact}
              style={{ width: '100%' }}
            >
              + Add Contact
            </button>
          </div>

          <div className="contacts-list">
            {contacts.map((c, i) => (
              <div key={i} className="contact-item-row">
                <span><strong>{c.alias}</strong> ({c.displayName})</span>
                <button
                  type="button"
                  onClick={() => removeContact(i)}
                  className="remove-btn"
                  aria-label="Remove contact"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="form-section">
          <h3>5. Voice Enrollment (Placeholder)</h3>
          <div className="voice-enroll-box">
            <p>Voice enrollment provides a secondary risk signal for identity verification.</p>
            <button
              type="button"
              className={`auth-secondary-btn ${voiceEnrolled ? 'enrolled' : ''}`}
              onClick={() => setVoiceEnrolled(true)}
            >
              {voiceEnrolled ? '✅ Voice Profile Enrolled' : '🎙️ Enroll Voice Profile'}
            </button>
          </div>
        </section>

        {error && <p className="error-banner">⚠️ {error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="auth-primary-btn"
          style={{ width: '100%', marginTop: '1rem' }}
        >
          {submitting ? 'Setting up...' : 'Save & Complete Onboarding'}
        </button>
      </form>
    </div>
  );
};
