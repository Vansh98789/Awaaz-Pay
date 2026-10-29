import React, { useEffect, useState } from 'react';

interface ApprovalDetails {
  approvalId: string;
  token: string;
  status: string;
  transactionId: string;
  amount: number;
  currency: string;
  payee: string;
  userName: string;
  createdAt: string;
  expiresAt?: string;
  isExpired: boolean;
}

export const GuardianApprovePage: React.FC<{ token: string }> = ({ token }) => {
  const [details, setDetails] = useState<ApprovalDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const [decisionResult, setDecisionResult] = useState<'approved' | 'denied' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchApproval() {
      try {
        setLoading(true);
        const res = await fetch(`/api/approvals/${token}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load approval request');
        }
        const data = await res.json();
        setDetails(data);
        if (data.status === 'approved' || data.status === 'denied') {
          setDecisionResult(data.status);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchApproval();
  }, [token]);

  const handleDecision = async (decision: 'approve' | 'deny') => {
    try {
      setDeciding(true);
      setError(null);
      const res = await fetch(`/api/approvals/${token}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit decision');
      }

      setDecisionResult(decision === 'approve' ? 'approved' : 'denied');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeciding(false);
    }
  };

  if (loading) {
    return (
      <div className="guardian-page-container">
        <div className="guardian-card loading">
          <h2>⏳ Loading approval request...</h2>
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="guardian-page-container">
        <div className="guardian-card error-card">
          <h2>⚠️ Unable to load approval</h2>
          <p>{error || 'Request not found'}</p>
          <a href="/" className="back-link">Return to Home</a>
        </div>
      </div>
    );
  }

  if (decisionResult) {
    return (
      <div className="guardian-page-container">
        <div className={`guardian-card result-card ${decisionResult}`}>
          <div className="result-icon">{decisionResult === 'approved' ? '✅' : '🛑'}</div>
          <h2>Payment {decisionResult === 'approved' ? 'Approved' : 'Denied'}</h2>
          <p>
            You {decisionResult} ₹{details.amount} to <strong>{details.payee}</strong> for {details.userName}.
          </p>
          <p className="sub-note">
            {decisionResult === 'approved'
              ? 'The user will be prompted to speak their final confirmation.'
              : 'The transaction has been safely stopped.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="guardian-page-container">
      <header className="guardian-header">
        <h1>🛡️ Awaaz Pay Guardian Portal</h1>
        <p className="guardian-subtitle">Family Protection & Approval Request</p>
      </header>

      <main className="guardian-card request-card">
        <div className="request-badge">⚠️ Tier 3 Limit Reached</div>

        <div className="request-details">
          <div className="detail-row">
            <span className="detail-label">User:</span>
            <span className="detail-value">{details.userName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Paying To:</span>
            <span className="detail-value payee-name">{details.payee}</span>
          </div>
          <div className="detail-row highlight-row">
            <span className="detail-label">Amount:</span>
            <span className="detail-value amount-value">₹{details.amount.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div className="flagged-box">
          <p className="flagged-title">Why was this flagged?</p>
          <p className="flagged-reason">
            Amount exceeds normal spending limits or is sent to a new payee requiring guardian confirmation.
          </p>
        </div>

        <div className="guardian-buttons-grid">
          <button
            type="button"
            className="giant-decision-btn approve-btn"
            onClick={() => handleDecision('approve')}
            disabled={deciding || details.isExpired}
            aria-label="Approve payment"
          >
            <span className="btn-icon">✅</span>
            <span className="btn-text">Approve</span>
            <span className="btn-subtext">Allow this payment</span>
          </button>

          <button
            type="button"
            className="giant-decision-btn deny-btn"
            onClick={() => handleDecision('deny')}
            disabled={deciding || details.isExpired}
            aria-label="Deny payment"
          >
            <span className="btn-icon">🛑</span>
            <span className="btn-text">Deny</span>
            <span className="btn-subtext">Stop this payment</span>
          </button>
        </div>
      </main>
    </div>
  );
};
