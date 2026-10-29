import React, { useState } from 'react';
import {
  Page,
  DotWordmark,
  Headline,
  BodyText,
  BigButton,
  BrailleCells,
  StatusBanner,
} from '../design/index.js';

interface ContactInput {
  alias: string;
  displayName: string;
  paypalEmail: string;
}

export const OnboardingWizard: React.FC = () => {
  const [step, setStep] = useState<number>(1);
  const totalSteps = 5;

  // Form states
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

  const handleSubmit = async () => {
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
      <Page
        headerContent={<DotWordmark size={140} />}
        footerContent={
          <BigButton variant="primary" onClick={() => (window.location.href = '/')}>
            Go to Wallet Home
          </BigButton>
        }
      >
        <StatusBanner variant="success" label="Complete">
          Profile and settings saved successfully! {name} is ready to make safe voice payments.
        </StatusBanner>
        <BrailleCells totalCells={5} activeCells={5} label="Onboarding complete" />
      </Page>
    );
  }

  const stepLabels = [
    'User Profile',
    'Spending Limits',
    'Guardian Contact',
    'Trusted Contacts',
    'Final Review',
  ];

  return (
    <Page
      headerContent={
        <>
          <DotWordmark size={140} />
          <Headline level={1}>{stepLabels[step - 1]}</Headline>
          <BrailleCells
            totalCells={totalSteps}
            activeCells={step}
            label={`Step ${step} of ${totalSteps}: ${stepLabels[step - 1]}`}
          />
        </>
      }
      footerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          {error && <StatusBanner variant="danger" label="Error">{error}</StatusBanner>}

          <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
            {step > 1 && (
              <BigButton
                variant="secondary"
                onClick={() => setStep((s) => s - 1)}
                disabled={submitting}
              >
                Back
              </BigButton>
            )}

            {step < totalSteps ? (
              <BigButton
                variant="primary"
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </BigButton>
            ) : (
              <BigButton
                variant="primary"
                onClick={handleSubmit}
                loading={submitting}
                loadingText="Saving profile..."
              >
                Save & Complete
              </BigButton>
            )}
          </div>

          <a
            href="/"
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-body)',
              marginTop: '0.5rem',
            }}
          >
            Cancel and Return Home
          </a>
        </div>
      }
    >
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Step 1: User Profile */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <label style={{ fontSize: 'var(--text-body-large)', fontWeight: 700 }}>
              User Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 'var(--min-target, 64px)',
                  padding: '1rem',
                  fontSize: 'var(--text-body)',
                  borderRadius: 'var(--radius-card, 16px)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  marginTop: '0.5rem',
                }}
              />
            </label>

            <label style={{ fontSize: 'var(--text-body-large)', fontWeight: 700 }}>
              Primary Language
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'hi' | 'en')}
                style={{
                  width: '100%',
                  minHeight: 'var(--min-target, 64px)',
                  padding: '1rem',
                  fontSize: 'var(--text-body)',
                  borderRadius: 'var(--radius-card, 16px)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  marginTop: '0.5rem',
                }}
              >
                <option value="hi">हिंदी (Hindi)</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        )}

        {/* Step 2: Spending Limits */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <label style={{ fontSize: 'var(--text-body-large)', fontWeight: 700 }}>
              Daily Spending Limit (₹)
              <input
                type="number"
                value={dailyTotal}
                onChange={(e) => setDailyTotal(Number(e.target.value))}
                style={{
                  width: '100%',
                  minHeight: 'var(--min-target, 64px)',
                  padding: '1rem',
                  fontSize: 'var(--text-body)',
                  borderRadius: 'var(--radius-card, 16px)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  marginTop: '0.5rem',
                }}
              />
            </label>

            <label style={{ fontSize: 'var(--text-body-large)', fontWeight: 700 }}>
              New Payee Per-Transaction Cap (₹)
              <input
                type="number"
                value={perPaymentCap}
                onChange={(e) => setPerPaymentCap(Number(e.target.value))}
                style={{
                  width: '100%',
                  minHeight: 'var(--min-target, 64px)',
                  padding: '1rem',
                  fontSize: 'var(--text-body)',
                  borderRadius: 'var(--radius-card, 16px)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  marginTop: '0.5rem',
                }}
              />
            </label>
          </div>
        )}

        {/* Step 3: Guardian Details */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <label style={{ fontSize: 'var(--text-body-large)', fontWeight: 700 }}>
              Guardian Name
              <input
                type="text"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 'var(--min-target, 64px)',
                  padding: '1rem',
                  fontSize: 'var(--text-body)',
                  borderRadius: 'var(--radius-card, 16px)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  marginTop: '0.5rem',
                }}
              />
            </label>

            <label style={{ fontSize: 'var(--text-body-large)', fontWeight: 700 }}>
              Guardian Phone / Contact
              <input
                type="tel"
                value={guardianContact}
                onChange={(e) => setGuardianContact(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 'var(--min-target, 64px)',
                  padding: '1rem',
                  fontSize: 'var(--text-body)',
                  borderRadius: 'var(--radius-card, 16px)',
                  border: '2px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  marginTop: '0.5rem',
                }}
              />
            </label>
          </div>
        )}

        {/* Step 4: Trusted Contacts */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <BodyText muted>Add trusted family members or local shops:</BodyText>

            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {contacts.map((c, idx) => (
                <li
                  key={idx}
                  style={{
                    padding: '1rem',
                    backgroundColor: 'var(--surface)',
                    border: '2px solid var(--border)',
                    borderRadius: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{c.displayName}</strong> ({c.alias})
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{c.paypalEmail}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeContact(idx)}
                    style={{
                      minHeight: '48px',
                      padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: 'var(--danger)',
                      color: 'var(--danger-text)',
                      border: 'none',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    aria-label={`Remove ${c.displayName}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div style={{ padding: '1rem', border: '2px dashed var(--border)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input
                type="text"
                placeholder="Alias (e.g. Bhaiya)"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                style={{
                  minHeight: '48px',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
              <input
                type="text"
                placeholder="Full Name (e.g. Ramesh Kumar)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{
                  minHeight: '48px',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
              <input
                type="email"
                placeholder="PayPal Email (e.g. bhaiya@sandbox.com)"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                style={{
                  minHeight: '48px',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
              <BigButton variant="secondary" onClick={addContact}>
                + Add Contact
              </BigButton>
            </div>
          </div>
        )}

        {/* Step 5: Final Review */}
        {step === 5 && (
          <div
            style={{
              padding: '1.5rem',
              backgroundColor: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius-card, 16px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div>
              <BodyText muted>User:</BodyText>
              <strong>{name} ({language === 'hi' ? 'Hindi' : 'English'})</strong>
            </div>
            <div>
              <BodyText muted>Daily Limit:</BodyText>
              <strong>₹{dailyTotal}</strong>
            </div>
            <div>
              <BodyText muted>New Payee Limit:</BodyText>
              <strong>₹{perPaymentCap}</strong>
            </div>
            <div>
              <BodyText muted>Guardian:</BodyText>
              <strong>{guardianName} ({guardianContact})</strong>
            </div>
            <div>
              <BodyText muted>Trusted Contacts:</BodyText>
              <strong>{contacts.map((c) => c.displayName).join(', ') || 'None'}</strong>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
};
