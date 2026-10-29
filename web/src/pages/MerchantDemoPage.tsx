import React, { useState, useEffect } from 'react';

interface InvoiceData {
  invoiceId: string;
  localId: string;
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

export const MerchantDemoPage: React.FC = () => {
  const [amount, setAmount] = useState<number>(250);
  const [note, setNote] = useState<string>('Cab ride to Connaught Place');
  const [loading, setLoading] = useState<boolean>(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipientQr, setRecipientQr] = useState<{ name: string; paypalEmail: string; qrCodeImage: string } | null>(null);
  const [recipientQrLoading, setRecipientQrLoading] = useState(false);
  const [recipientName, setRecipientName] = useState('Ravi Cabs');
  const [recipientEmail, setRecipientEmail] = useState('');

  const presets = [150, 250, 500, 750];

  // Auto-generate initial invoice on mount
  useEffect(() => {
    handleGenerateInvoice(250);
  }, []);

  // Poll status of generated invoice to show live PAID badge
  useEffect(() => {
    if (!invoice || invoice.status === 'PAID') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/invoices/${invoice.invoiceId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'PAID' && invoice.status !== 'PAID') {
          setInvoice((prev) => (prev ? { ...prev, status: 'PAID' } : null));
        }
      } catch {
        // Ignored in poll
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [invoice]);

  const handleGenerateInvoice = async (invoiceAmount: number) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch('/api/merchant/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: 'merchant_ravi_cabs',
          amount: Number(invoiceAmount),
          currency: 'INR',
          note,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create invoice');
      }

      const data = await res.json();
      setInvoice(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateRecipientQr = async () => {
    try {
      setRecipientQrLoading(true);
      setError(null);
      const res = await fetch('/api/merchant/recipient-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: 'merchant_ravi_cabs',
          name: recipientName,
          paypalEmail: recipientEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create recipient QR');
      setRecipientQr(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecipientQrLoading(false);
    }
  };

  return (
    <div className="guardian-page-container">
      <header className="guardian-header">
        <h1>🚖 Ravi Cabs · Merchant Portal</h1>
        <p className="guardian-subtitle">Create a fixed fare QR for an in-person ride</p>
      </header>

      <div className="guardian-card request-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="request-badge" style={{ backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: '#38bdf8', color: '#38bdf8' }}>
            ✓ Verified Merchant
          </div>
          {invoice && (
            <div
              className="request-badge"
              style={{
                backgroundColor: invoice.status === 'PAID' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                borderColor: invoice.status === 'PAID' ? '#22c55e' : '#f59e0b',
                color: invoice.status === 'PAID' ? '#86efac' : '#fbbf24',
              }}
            >
              {invoice.status === 'PAID' ? '✅ PAID' : '⏳ AWAITING SCAN & PAYMENT'}
            </div>
          )}
        </div>

        {/* Preset Amount Selector */}
        <section className="form-section" style={{ border: 'none', padding: 0 }}>
          <label style={{ marginBottom: '0.5rem' }}>Select Fare Amount (₹):</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className="action-pill-btn"
                style={{
                  backgroundColor: amount === p ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                  color: amount === p ? '#000000' : 'var(--text-primary)',
                  fontWeight: 700,
                  padding: '0.65rem 0.5rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setAmount(p);
                  handleGenerateInvoice(p);
                }}
              >
                ₹{p}
              </button>
            ))}
          </div>

          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="form-input"
              style={{ width: '130px' }}
              placeholder="Fare amount"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="form-input"
              style={{ flex: 1 }}
              placeholder="Trip description"
            />
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => handleGenerateInvoice(amount)}
              disabled={loading || amount <= 0}
            >
              {loading ? 'Creating...' : 'Update QR'}
            </button>
          </div>
        </section>

        <section className="form-section" aria-labelledby="recipient-qr-heading">
          <h2 id="recipient-qr-heading">New recipient QR · no amount</h2>
          <p>Share this code to let Awaaz Pay read the recipient name and PayPal email. The name is not verified by PayPal; scanned recipients go through the safety hold.</p>
          <label htmlFor="recipient-qr-name">Recipient name</label>
          <input id="recipient-qr-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="form-input" />
          <label htmlFor="recipient-qr-email">Recipient PayPal Sandbox email</label>
          <input id="recipient-qr-email" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} className="form-input" placeholder="Blank uses the demo recipient account" />
          <button
            type="button"
            className="auth-secondary-btn"
            onClick={handleGenerateRecipientQr}
            disabled={recipientQrLoading}
            style={{ minHeight: '64px' }}
          >
            {recipientQrLoading ? 'Creating recipient QR…' : 'Create recipient QR'}
          </button>
          {recipientQr && (
            <div style={{ display: 'grid', justifyItems: 'center', gap: '0.5rem', padding: '1rem', marginTop: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)' }}>
              <img src={recipientQr.qrCodeImage} alt={`Awaaz Pay recipient QR for ${recipientQr.name}; it contains an unverified name and PayPal email`} style={{ width: '240px', height: '240px', background: '#fff' }} />
              <strong>{recipientQr.name}</strong>
              <span>{recipientQr.paypalEmail}</span>
              <span>Recipient details only. No payment amount is encoded.</span>
            </div>
          )}
        </section>

        {error && <p className="error-banner">⚠️ {error}</p>}

        {/* QR Code Display Container */}
        {invoice && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              padding: '1.5rem',
              borderRadius: '1.25rem',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
              margin: '0.75rem 0',
            }}
          >
            <img
              src={invoice.qrCodeImage}
              alt={`QR Code for ${invoice.merchantName} fare of ₹${invoice.amount}`}
              style={{
                width: '260px',
                height: '260px',
                objectFit: 'contain',
                display: 'block',
              }}
            />
            <div style={{ marginTop: '1rem', textAlign: 'center', color: '#0f172a' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                ₹{invoice.amount.toLocaleString('en-IN')}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#475569', fontWeight: 600 }}>
                {invoice.merchantName} · {invoice.paymentMode === 'paypal_invoice' ? 'PayPal invoice QR' : 'Awaaz Pay wallet QR'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace', marginTop: '0.25rem' }}>
                {invoice.invoiceId}
              </div>
            </div>
          </div>
        )}

        <div className="request-details">
          <div className="detail-row">
            <span className="detail-label">Merchant:</span>
            <span className="detail-value">Ravi Cabs</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Merchant PayPal account:</span>
            <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
              {invoice?.merchantEmail || '—'}
            </span>
          </div>
          {invoice && invoice.paymentMode === 'awaaz_pay_payout' && (
            <div className="detail-row">
              <span className="detail-label">Settlement:</span>
              <span className="detail-value">
                Awaaz Pay sends a PayPal sandbox payout to {invoice.settlementEmail} after the customer confirms in the wallet.
              </span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Trust Tier:</span>
            <span className="detail-value">Tier 2 (Verified Merchant QR Spot Payment)</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem' }}>
          <a href="/" className="back-link">
            ← Return to Awaaz Pay Wallet
          </a>
        </div>
      </div>
    </div>
  );
};
