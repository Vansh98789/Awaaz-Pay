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
  borderRadius: 'var(--radius-card, 16px)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.5rem',
  fontSize: '1.25rem',
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
        padding: '2rem 0',
        color: 'var(--text)',
      }}
    >
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 8vw, 2.75rem)', lineHeight: 1.2 }}>Merchant payment QR</h1>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '1.25rem' }}>
          Enter your business and payment details to make a QR code your customer can scan.
        </p>
      </header>

      <form onSubmit={handleGenerateInvoice} style={{ display: 'grid', gap: '1.5rem' }}>
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
          <label htmlFor="merchant-email" style={labelStyle}>PayPal Sandbox email</label>
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
          />
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            Payments use PayPal Sandbox while this app is in test mode.
          </p>
        </div>

        <div>
          <label htmlFor="payment-amount" style={labelStyle}>Amount (USD)</label>
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
            style={fieldStyle}
            placeholder="0.00"
          />
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
          }}
        >
          {loading ? 'Creating payment QR…' : 'Create payment QR'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ marginTop: '1.5rem', padding: '1rem', border: '2px solid var(--danger)', borderRadius: 'var(--radius-card, 16px)', color: 'var(--danger)' }}>
          Error: {error}
        </p>
      )}

      {invoice && (
        <section aria-labelledby="payment-qr-heading" aria-live="polite" style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '2px solid var(--border)' }}>
          <h2 id="payment-qr-heading" style={{ fontSize: '1.5rem' }}>Payment QR is ready</h2>
          <p role="status" style={{ marginTop: '0.5rem', fontSize: '1.25rem' }}>
            {invoice.status === 'PAID' ? 'Payment received.' : 'Waiting for your customer to scan and pay.'}
          </p>
          <div style={{ display: 'grid', justifyItems: 'center', gap: '1rem', marginTop: '1.5rem', padding: '1rem', background: '#fff', borderRadius: 'var(--radius-card, 16px)' }}>
            <img
              src={invoice.qrCodeImage}
              alt={`Payment QR for ${invoice.merchantName}, ${invoice.amount.toFixed(2)} US dollars`}
              style={{ display: 'block', width: 'min(100%, 280px)', height: 'auto', aspectRatio: '1', objectFit: 'contain' }}
            />
            <strong style={{ color: '#111', fontSize: '1.5rem', textAlign: 'center' }}>
              ${invoice.amount.toFixed(2)} · {invoice.merchantName}
            </strong>
            <span style={{ color: '#333', textAlign: 'center' }}>
              {invoice.paymentMode === 'paypal_invoice' ? 'PayPal invoice' : 'Awaaz Pay payment'} · {invoice.invoiceId}
            </span>
          </div>
          {invoice.paymentMode === 'awaaz_pay_payout' && (
            <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>
              After the customer confirms the payment, the app sends the payout to {invoice.settlementEmail}.
            </p>
          )}
        </section>
      )}

      <p style={{ marginTop: '2rem' }}>
        <a href="/" style={{ minHeight: '64px', display: 'inline-flex', alignItems: 'center', color: 'var(--accent)', fontSize: '1.25rem' }}>
          ← Return to Awaaz Pay
        </a>
      </p>
    </main>
  );
};
