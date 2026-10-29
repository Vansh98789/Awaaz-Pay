import React, { useEffect, useState } from 'react';
import {
  Page,
  DotWordmark,
  Headline,
  BodyText,
  BigButton,
  StatusBanner,
} from '../design/index.js';

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
      <Page headerContent={<DotWordmark size={140} />}>
        <Headline level={1}>Loading approval...</Headline>
        <BodyText muted>Please wait while we fetch the transaction details.</BodyText>
      </Page>
    );
  }

  if (error || !details) {
    return (
      <Page
        headerContent={<DotWordmark size={140} />}
        footerContent={
          <BigButton variant="secondary" onClick={() => (window.location.href = '/')}>
            Return to Home
          </BigButton>
        }
      >
        <StatusBanner variant="danger" label="Error">
          {error || 'Approval request not found or expired.'}
        </StatusBanner>
      </Page>
    );
  }

  if (decisionResult) {
    return (
      <Page
        headerContent={<DotWordmark size={140} />}
        footerContent={
          <BigButton variant="primary" onClick={() => (window.location.href = '/')}>
            Done
          </BigButton>
        }
      >
        <StatusBanner
          variant={decisionResult === 'approved' ? 'success' : 'danger'}
          label={decisionResult === 'approved' ? 'Approved' : 'Denied'}
        >
          You {decisionResult} ₹{details.amount} to <strong>{details.payee}</strong> for {details.userName}.
        </StatusBanner>
        <BodyText size="large" muted>
          {decisionResult === 'approved'
            ? 'The user will be prompted on their phone to speak their final confirmation.'
            : 'The transaction has been safely stopped.'}
        </BodyText>
      </Page>
    );
  }

  return (
    <Page
      headerContent={
        <>
          <DotWordmark size={140} />
          <Headline level={1}>Guardian Approval</Headline>
          <BodyText muted>A high-value or new-payee transaction requires your review.</BodyText>
        </>
      }
      footerContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          <BigButton
            variant="primary"
            onClick={() => handleDecision('approve')}
            disabled={deciding || details.isExpired}
            loading={deciding}
            loadingText="Submitting decision..."
          >
            Approve ₹{details.amount}
          </BigButton>

          <BigButton
            variant="danger"
            onClick={() => handleDecision('deny')}
            disabled={deciding || details.isExpired}
          >
            Deny Payment
          </BigButton>
        </div>
      }
    >
      <div
        style={{
          width: '100%',
          backgroundColor: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius-card, 16px)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <BodyText muted>User:</BodyText>
          <strong style={{ fontSize: 'var(--text-body-large)' }}>{details.userName}</strong>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <BodyText muted>Paying to:</BodyText>
          <strong style={{ fontSize: 'var(--text-body-large)' }}>{details.payee}</strong>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '1rem',
            backgroundColor: 'var(--bg)',
            borderRadius: '12px',
          }}
        >
          <BodyText muted>Amount:</BodyText>
          <div
            style={{
              fontSize: 'var(--text-amount, 4.5rem)',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              lineHeight: 1,
            }}
          >
            ₹{details.amount}
          </div>
        </div>

        <StatusBanner variant="warning" label="Flagged">
          Amount exceeds standard spending limits or is sent to an unverified recipient.
        </StatusBanner>
      </div>
    </Page>
  );
};
