import React, { useEffect, useState } from 'react';

interface InvoiceData {
  invoiceId: string;
  localId: string;
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
  settlementEmail: string;
  verified: boolean;
  amount: number;
  currency: string;
  status: string;
  qrCodeUrl: string | null;
  qrCodeImage: string;
  paymentMode: 'paypal_invoice' | 'awaaz_pay_payout';
  paypalInvoiceCreated: boolean;
}

const fieldStyle: React.CSSProperties = {
  minHeight: 'var(--min-target, 64px)',
  width: '100%',
  padding: '0.75rem 1rem',
  border: '2px solid var(--border)',
  borderRadius: '12px',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.5rem',
  fontSize: '1.125rem',
  fontWeight: 700,
};

export const MerchantDemoPage: React.FC = () => {
  const [merchantName, setMerchantName] = useState('');
  const [merchantEmail, setMerchantEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice || invoice.status === 'PAID') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoice.invoiceId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'PAID') {
          setInvoice((prev) => (prev ? { ...prev, status: 'PAID' } : null));
        }
      } catch {
        // Keep showing the current invoice if status polling is temporarily unavailable.
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [invoice]);

  const handleGenerateInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError(null);
      setInvoice(null);

      const res = await fetch('/api/merchant/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantName: merchantName.trim(),
          merchantEmail: merchantEmail.trim(),
          amount: Number(amount),
          currency: 'USD',
          note: note.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create payment QR');
      setInvoice(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      id="main-content"
      style={{
        width: 'min(100% - 2rem, 560px)',
        margin: '0 auto',
        padding: '1.5rem 0 2rem',
        color: 'var(--text)',
      }}
    >
      <header style={{ marginBottom: '2rem' }}>
        <a
          href="/"
          style={{ minHeight: '64px', minWidth: '64px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.5rem 1rem', border: '2px solid var(--border)', borderRadius: 'var(--radius-pill, 9999px)', background: 'var(--surface)', color: 'var(--text)', textDecoration: 'none', fontSize: '1rem', fontWeight: 700 }}
        >
          <span aria-hidden="true">←</span>
          Back to wallet
        </a>
        <p style={{ color: 'var(--accent)', fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Awaaz Pay · Merchant tools
        </p>
        <h1 style={{ marginTop: '0.5rem', fontSize: 'clamp(2rem, 8vw, 2.75rem)', lineHeight: 1.15, letterSpacing: '-0.035em' }}>
          Get paid with a QR
        </h1>
        <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1.5 }}>
          Create a payment request for your customer to scan with Awaaz Pay.
        </p>
        <ol aria-label="Payment QR steps" style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem', margin: '1.5rem 0 0', padding: 0 }}>
          {['Enter details', 'Show your QR', 'Get paid'].map((step, index) => (
            <li key={step} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 650 }}>
              <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: 'none', width: '28px', height: '28px', borderRadius: '50%', background: index === 0 ? 'var(--accent)' : 'var(--surface)', border: `1px solid ${index === 0 ? 'var(--accent)' : 'var(--border)'}`, color: index === 0 ? 'var(--accent-text)' : 'var(--text)' }}>
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </header>

      <form onSubmit={handleGenerateInvoice} style={{ display: 'grid', gap: '1.25rem' }}>
        <div style={{ paddingBottom: '0.25rem', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Payment details</h2>
          <p style={{ marginTop: '0.25rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>Your customer will see these details before paying.</p>
        </div>

        <div>
          <label htmlFor="merchant-name" style={labelStyle}>Business or merchant name</label>
          <input
            id="merchant-name"
            name="merchantName"
            autoComplete="organization"
            required
            maxLength={80}
            value={merchantName}
            onChange={(event) => setMerchantName(event.target.value)}
            style={fieldStyle}
            placeholder="Example: Ravi Cabs"
          />
        </div>

        <div>
          <label htmlFor="merchant-email" style={labelStyle}>PayPal Sandbox receiving email</label>
          <input
            id="merchant-email"
            name="merchantEmail"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={merchantEmail}
            onChange={(event) => setMerchantEmail(event.target.value)}
            style={fieldStyle}
            placeholder="merchant@example.com"
            aria-describedby="merchant-email-help"
          />
          <p id="merchant-email-help" style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            Use the PayPal Sandbox account where you want to receive this test payment.
          </p>
        </div>

        <div>
          <label htmlFor="payment-amount" style={labelStyle}>Amount (USD)</label>
          <div style={{ position: 'relative' }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '1.5rem', fontWeight: 700 }}>$</span>
            <input
              id="payment-amount"
              name="amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="100000"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              style={{ ...fieldStyle, paddingLeft: '2.75rem', fontSize: '1.5rem', fontWeight: 700 }}
              placeholder="0.00"
            />
          </div>
        </div>

        <div>
          <label htmlFor="payment-note" style={labelStyle}>What is this payment for? (optional)</label>
          <input
            id="payment-note"
            name="note"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            style={fieldStyle}
            placeholder="For example, cab ride or groceries"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          style={{
            minHeight: 'var(--min-target, 64px)',
            width: '100%',
            padding: '0.75rem 1rem',
            border: 0,
            borderRadius: 'var(--radius-pill, 9999px)',
            background: 'var(--accent)',
            color: 'var(--accent-text, #fff)',
            font: 'inherit',
            fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
            boxShadow: '0 8px 20px rgba(29, 78, 216, 0.18)',
          }}
        >
          {loading ? 'Creating your QR…' : '▦  Create payment QR'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ marginTop: '1.5rem', padding: '1rem', border: '2px solid var(--danger)', borderRadius: 'var(--radius-card, 16px)', color: 'var(--danger)' }}>
          Error: {error}
        </p>
      )}

      {invoice && (
        <section aria-labelledby="payment-qr-heading" aria-live="polite" style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '2px solid var(--border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <div>
              <p style={{ color: 'var(--accent)', fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Payment request</p>
              <h2 id="payment-qr-heading" style={{ marginTop: '0.25rem', fontSize: '1.75rem', fontWeight: 700 }}>
                {invoice.status === 'PAID' ? 'Payment received' : 'Your QR is ready'}
              </h2>
            </div>
            <span role="status" style={{ padding: '0.45rem 0.8rem', border: `2px solid ${invoice.status === 'PAID' ? 'var(--success)' : 'var(--warning)'}`, borderRadius: 'var(--radius-pill, 9999px)', background: 'var(--surface)', color: invoice.status === 'PAID' ? 'var(--success)' : 'var(--warning)', fontSize: '0.85rem', fontWeight: 750, letterSpacing: '0.04em' }}>
              {invoice.status === 'PAID' ? 'PAID' : 'AWAITING PAYMENT'}
            </span>
          </div>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '1.1rem' }}>
            {invoice.status === 'PAID' ? 'Your customer completed this payment.' : 'Ask your customer to scan this code in Awaaz Pay.'}
          </p>
          <div style={{ display: 'grid', justifyItems: 'center', gap: '1rem', marginTop: '1.5rem', padding: '1.5rem 1rem', background: '#fff', border: '2px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
            <img
              src={invoice.qrCodeImage}
              alt={`Payment QR for ${invoice.merchantName}, ${invoice.amount.toFixed(2)} US dollars`}
              style={{ display: 'block', width: 'min(100%, 300px)', height: 'auto', aspectRatio: '1', objectFit: 'contain', imageRendering: 'pixelated' }}
            />
            <div style={{ width: '100%', paddingTop: '1rem', borderTop: '1px solid #d6d6d2', textAlign: 'center', color: '#111' }}>
              <strong style={{ display: 'block', fontSize: '2rem', lineHeight: 1.2 }}>
                ${invoice.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
              <span style={{ display: 'block', marginTop: '0.35rem', fontSize: '1.1rem', fontWeight: 650 }}>{invoice.merchantName}</span>
              <span style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.85rem', color: '#4A4A4A' }}>Invoice {invoice.invoiceId}</span>
            </div>
          </div>
          <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            This is a PayPal Sandbox test payment. The payment is sent to {invoice.settlementEmail} after the customer confirms it.
          </p>
        </section>
      )}

    </main>
  );
};
