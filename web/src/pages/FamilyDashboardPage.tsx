import React, { useState, useEffect, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type RowClassRules,
} from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

interface ActivityRow {
  id: string;
  time: string;
  direction: 'IN' | 'OUT';
  counterparty: string;
  counterpartyType: string;
  amount: number;
  currency: string;
  tier: string;
  riskScore: number;
  risk: string;
  decision: string;
  status: string;
  paypalRef?: string;
  isFlagged: boolean;
}

interface PendingApproval {
  id: string;
  token: string;
  amount: number;
  payee: string;
  createdAt: string;
  expiresAt?: string;
  url: string;
}

interface FamilyContact {
  id: string;
  alias: string;
  display_name: string;
  paypal_email: string;
  status: 'active' | 'cooling_off';
  activated_at: string | null;
}

interface FamilyBlockedRecipient {
  id: string;
  paypal_email: string;
  reason: string;
}

interface LimitsData {
  daily_total: number;
  per_transaction_new_payee: number;
  max_new_payees_per_day: number;
}

const customGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--bg-card)',
  foregroundColor: 'var(--text-primary)',
  headerBackgroundColor: 'var(--bg-primary)',
  headerTextColor: 'var(--accent-cyan)',
  borderColor: 'var(--border-subtle)',
  rowHoverColor: 'var(--bg-surface)',
  fontFamily: 'var(--font-sans)',
});

export const FamilyDashboardPage: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {
  const [userName, setUserName] = useState<string>('Meena');
  const [paypalBalance, setPaypalBalance] = useState<{ available: string; total: string; asOf: string | null; accountEmail?: string | null } | null>(null);
  const [paypalBalanceError, setPaypalBalanceError] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [limits, setLimits] = useState<LimitsData>({
    daily_total: 5000,
    per_transaction_new_payee: 500,
    max_new_payees_per_day: 2,
  });
  const [transactions, setTransactions] = useState<ActivityRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [blockedRecipients, setBlockedRecipients] = useState<FamilyBlockedRecipient[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactAlias, setContactAlias] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactMessage, setContactMessage] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [blockedEmail, setBlockedEmail] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blocklistError, setBlocklistError] = useState<string | null>(null);
  const [blocklistMessage, setBlocklistMessage] = useState<string | null>(null);
  const [savingBlock, setSavingBlock] = useState(false);
  const [changingBlockId, setChangingBlockId] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
    fetchPayPalBalance();
  }, []);

  const fetchPayPalBalance = async () => {
    setLoadingBalance(true);
    try {
      setPaypalBalanceError(null);
      const res = await fetch('/api/family/paypal-balance');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'PayPal balance is unavailable');
      setPaypalBalance({ available: data.available, total: data.total, asOf: data.asOf, accountEmail: data.accountEmail });
    } catch (err) {
      setPaypalBalance(null);
      const message = (err as Error).message || '';
      setPaypalBalanceError(/fetch failed|failed to fetch/i.test(message)
        ? 'Could not reach PayPal Sandbox just now.'
        : message);
    } finally {
      setLoadingBalance(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [res, blocklistResponse] = await Promise.all([
        fetch('/api/family/dashboard?userId=user_meena', { credentials: 'include' }),
        fetch('/api/family/blocklist', { credentials: 'include' }),
      ]);
      if (!res.ok || !blocklistResponse.ok) {
        throw new Error('Failed to load family dashboard');
      }
      const [data, blocklistData] = await Promise.all([res.json(), blocklistResponse.json()]);
      setUserName(data.userName || 'Meena');
      if (data.limits) setLimits({ ...data.limits, daily_total: Math.min(Number(data.limits.daily_total) || 5000, 5000) });
      setTransactions(data.transactions || []);
      setPendingApprovals(data.pendingApprovals || []);
      setContacts(data.contacts || []);
      setBlockedRecipients(blocklistData.blocklist || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addRegularPayee = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingContact(true);
      setContactError(null);
      setContactMessage(null);
      const response = await fetch('/api/family/contacts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: contactName.trim(),
          alias: contactAlias.trim() || contactName.trim(),
          paypalEmail: contactEmail.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add this payee.');
      setContacts((previous) => [...previous, data.contact].sort((a, b) => a.alias.localeCompare(b.alias)));
      setContactName('');
      setContactAlias('');
      setContactEmail('');
      setShowAddContact(false);
      setContactMessage(data.inCoolingOff
        ? `${data.contact.display_name} was added. They can be used as a regular payee after the ${data.coolingHours}-hour safety hold.`
        : `${data.contact.display_name} was added to the regular payee list.`);
    } catch (err) {
      setContactError((err as Error).message || 'Could not add this payee.');
    } finally {
      setSavingContact(false);
    }
  };

  const blockRecipient = async (paypalEmail: string, reason: string) => {
    const normalizedEmail = paypalEmail.trim().toLowerCase();
    const response = await fetch('/api/family/blocklist', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paypalEmail: normalizedEmail, reason }),
    });
    const data = await response.json();
    if (!response.ok || !data.blocked) throw new Error(data.error || 'Could not block this recipient.');
    setBlockedRecipients((previous) => [
      data.blocked,
      ...previous.filter((item) => item.paypal_email.toLowerCase() !== normalizedEmail),
    ].sort((a, b) => a.paypal_email.localeCompare(b.paypal_email)));
    setContacts((previous) => previous.filter((contact) => contact.paypal_email.toLowerCase() !== normalizedEmail));
    return data.blocked as FamilyBlockedRecipient;
  };

  const addBlockedRecipient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingBlock(true);
      setBlocklistError(null);
      const item = await blockRecipient(blockedEmail, blockReason);
      setBlockedEmail('');
      setBlockReason('');
      setBlocklistMessage(`${item.paypal_email} is blocked. They were removed from regular payees if they were saved there.`);
    } catch (err) {
      setBlocklistError((err as Error).message || 'Could not block this recipient.');
    } finally {
      setSavingBlock(false);
    }
  };

  const blockSavedContact = async (contact: FamilyContact) => {
    try {
      setChangingBlockId(contact.id);
      setBlocklistError(null);
      const item = await blockRecipient(contact.paypal_email, 'Blocked by family from regular payees');
      setBlocklistMessage(`${item.paypal_email} is blocked and has been removed from regular payees.`);
    } catch (err) {
      setBlocklistError((err as Error).message || 'Could not block this recipient.');
    } finally {
      setChangingBlockId(null);
    }
  };

  const unblockRecipient = async (item: FamilyBlockedRecipient) => {
    const confirmed = window.confirm(`Unblock ${item.paypal_email}? Payments to this address may be attempted again if it is added as a payee.`);
    if (!confirmed) return;
    try {
      setChangingBlockId(item.id);
      setBlocklistError(null);
      setBlocklistMessage(null);
      const response = await fetch(`/api/family/blocklist/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not unblock this recipient.');
      setBlockedRecipients((previous) => previous.filter((entry) => entry.id !== item.id));
      setBlocklistMessage(`${item.paypal_email} was removed from the blocklist. It was not added back to regular payees.`);
    } catch (err) {
      setBlocklistError((err as Error).message || 'Could not unblock this recipient.');
    } finally {
      setChangingBlockId(null);
    }
  };

  const columnDefs: ColDef<ActivityRow>[] = useMemo(
    () => [
      {
        field: 'time',
        headerName: 'Time',
        width: 170,
        filter: 'agDateColumnFilter',
        valueFormatter: (params) => {
          if (!params.value) return '';
          try {
            return new Date(params.value).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
          } catch {
            return String(params.value);
          }
        },
      },
      {
        field: 'direction',
        headerName: 'Direction',
        width: 110,
        filter: true,
        cellRenderer: (params: any) => {
          const isDeposit = params.value === 'IN';
          return (
            <span
              style={{
                display: 'inline-block',
                padding: '0.2rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                backgroundColor: isDeposit ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: isDeposit ? '#86efac' : '#fca5a5',
              }}
            >
              {isDeposit ? '⬇ Received' : '⬆ Sent'}
            </span>
          );
        },
      },
      {
        field: 'counterparty',
        headerName: 'Counterparty',
        flex: 1,
        minWidth: 150,
        filter: true,
      },
      {
        field: 'amount',
        headerName: 'Amount',
        width: 120,
        filter: 'agNumberColumnFilter',
        valueFormatter: (params) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(params.value)),
        cellStyle: { fontWeight: '700' },
      },
      {
        field: 'tier',
        headerName: 'Tier',
        width: 100,
        filter: true,
      },
      {
        field: 'risk',
        headerName: 'Risk',
        width: 140,
        filter: true,
        cellRenderer: (params: any) => {
          const val = params.value;
          const color = val === 'High' ? 'var(--danger)' : val === 'Medium' ? 'var(--warning)' : 'var(--success)';
          const bg = val === 'High' ? 'rgba(239,68,68,0.2)' : val === 'Medium' ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)';
          const dots = val === 'High' ? '● ● ●' : val === 'Medium' ? '▲ ●' : '●';
          return (
            <span
              style={{
                padding: '0.25rem 0.65rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.85rem',
                fontWeight: 700,
                backgroundColor: bg,
                color,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <span>{val}</span>
              <span aria-hidden="true" style={{ fontSize: '0.75rem', opacity: 0.85 }}>{dots}</span>
            </span>
          );
        },
      },
      {
        field: 'decision',
        headerName: 'Decision',
        width: 190,
        filter: true,
        cellRenderer: (params: any) => {
          const d = params.value || '';
          const isBlock = d === 'block';
          const isApprove = d === 'need_guardian_approval';
          const label = isBlock ? 'Blocked' : isApprove ? 'Needs Approval' : 'Allowed';
          const dots = isBlock ? '■ ■ ■' : isApprove ? '▲ ▲' : '●';
          const color = isBlock ? 'var(--danger)' : isApprove ? 'var(--warning)' : 'var(--success)';
          return (
            <span style={{ fontWeight: 700, color, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>{label}</span>
              <span aria-hidden="true" style={{ fontSize: '0.8rem', opacity: 0.85 }}>{dots}</span>
            </span>
          );
        },
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 130,
        filter: true,
        cellRenderer: (params: any) => {
          const s = params.value;
          const isDone = s === 'completed';
          const isFailed = s === 'failed' || s === 'cancelled';
          const isPending = s === 'pending' || s === 'processing' || s === 'confirmed' || s === 'awaiting_approval';
          const color = isDone ? 'var(--success)' : isFailed ? 'var(--danger)' : isPending ? 'var(--warning)' : 'var(--text-secondary)';
          return <span style={{ fontWeight: 600, color }}>{s}</span>;
        },
      },
    ],
    []
  );

  const rowClassRules: RowClassRules<ActivityRow> = useMemo(
    () => ({
      'blocked-row': (params) =>
        params.data?.decision === 'block' || params.data?.status === 'failed',
      'pending-row': (params) =>
        params.data?.decision === 'need_guardian_approval' || params.data?.status === 'confirmed' || params.data?.status === 'awaiting_approval',
      'flagged-row': (params) => Boolean(params.data?.isFlagged),
    }),
    []
  );

  const summaryCardStyle: React.CSSProperties = {
    padding: '1.25rem',
    background: 'var(--surface)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius-card, 16px)',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.06)',
    color: 'var(--text)',
  };
  const summaryLabelStyle: React.CSSProperties = {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    fontWeight: 750,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  };
  const balanceReportTime = paypalBalance?.asOf && !Number.isNaN(Date.parse(paypalBalance.asOf))
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(paypalBalance.asOf))
    : null;

  return (
    <div className="guardian-page-container" style={{ maxWidth: '980px' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        <div>
          <p style={{ color: 'var(--accent)', fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Awaaz Pay · Family portal</p>
          <h1 style={{ marginTop: '0.35rem', color: 'var(--text)', fontSize: 'clamp(2rem, 6vw, 2.75rem)', letterSpacing: '-0.035em', lineHeight: 1.15 }}>Family dashboard</h1>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '1.1rem' }}>Review payments, manage regular payees, and handle approvals.</p>
        </div>
        <button type="button" onClick={onLogout} style={{ minHeight: '64px', minWidth: '64px', padding: '0.75rem 1.1rem', border: '2px solid var(--border)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
          Sign out
        </button>
      </header>

      {loading && (
        <div role="status" className="guardian-card loading" style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card, 16px)', color: 'var(--text-muted)' }}>
          Loading family activity…
        </div>
      )}

      <section
        aria-label="Family account overview"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <section style={{ ...summaryCardStyle, minHeight: '150px' }}>
          <span style={summaryLabelStyle}>Wallet owner</span>
          <h2 style={{ marginTop: '0.8rem', fontSize: '1.75rem', lineHeight: 1.2 }}>{userName}</h2>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Voice-first payment account</p>
        </section>

        <section aria-live="polite" aria-label="PayPal Sandbox balance" style={{ ...summaryCardStyle, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <span style={summaryLabelStyle}>PayPal Sandbox · USD</span>
            <button type="button" onClick={fetchPayPalBalance} disabled={loadingBalance} aria-busy={loadingBalance} style={{ minHeight: '64px', minWidth: '64px', padding: '0.5rem 0.9rem', border: '2px solid var(--border)', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 700, cursor: loadingBalance ? 'wait' : 'pointer' }}>
              {loadingBalance ? 'Updating…' : '↻ Refresh'}
            </button>
          </div>
          {paypalBalance ? (
            <>
              <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 650 }}>Available balance</p>
              <p style={{ marginTop: '0.15rem', color: 'var(--success)', fontSize: 'clamp(2rem, 6vw, 2.75rem)', fontWeight: 800, lineHeight: 1.1 }}>
                ${Number(paypalBalance.available).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '1rem', margin: '1.25rem 0 0', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <div>
                  <dt style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Total balance</dt>
                  <dd style={{ marginTop: '0.25rem', fontSize: '1.1rem', fontWeight: 750 }}>
                    ${Number(paypalBalance.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </div>
                {paypalBalance.accountEmail && (
                  <div style={{ minWidth: 0 }}>
                    <dt style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Sender account</dt>
                    <dd style={{ marginTop: '0.25rem', fontSize: '0.95rem', fontWeight: 650, overflowWrap: 'anywhere' }}>{paypalBalance.accountEmail}</dd>
                  </div>
                )}
              </dl>
              <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                {balanceReportTime ? `Balance report updated ${balanceReportTime}. ` : ''}Reports can lag; payout status confirms individual transfers.
              </p>
            </>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem' }}>{loadingBalance ? 'Checking balance…' : 'Balance unavailable'}</h2>
              <p style={{ marginTop: '0.4rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {paypalBalanceError || 'PayPal Sandbox balance has not loaded yet.'} Reports can take time to update.
              </p>
            </div>
          )}
        </section>

        <section style={{ ...summaryCardStyle, minHeight: '150px' }}>
          <span style={summaryLabelStyle}>Daily spend limit</span>
          <h2 style={{ marginTop: '0.8rem', fontSize: '1.75rem', lineHeight: 1.2 }}>
            ${limits.daily_total.toLocaleString('en-US')}
          </h2>
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            ${limits.per_transaction_new_payee.toLocaleString('en-US')} per new payee
          </p>
        </section>
      </section>

      {error && <p className="error-banner">⚠️ {error}</p>}

      <section
        aria-labelledby="regular-payees-heading"
        className="guardian-card"
        style={{ margin: '2rem 0', padding: '1.25rem', color: 'var(--text)', background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: 'var(--radius-card, 16px)', boxShadow: '0 6px 20px rgba(0, 0, 0, 0.06)' }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h2 id="regular-payees-heading" style={{ fontSize: '1.5rem', fontWeight: 700 }}>Regular payees</h2>
            <p style={{ marginTop: '0.5rem', color: 'var(--text-muted, #4A4A4A)', fontSize: '1.1rem' }}>
              Add people Meena pays often. Use their exact PayPal Sandbox email.
            </p>
          </div>
          <button
            type="button"
            aria-expanded={showAddContact}
            aria-controls="add-regular-payee-form"
            onClick={() => {
              setShowAddContact((open) => !open);
              setContactError(null);
              setContactMessage(null);
            }}
            style={{ minHeight: 'var(--min-target, 64px)', minWidth: '64px', width: '100%', maxWidth: '560px', padding: '0.75rem 1rem', border: 0, borderRadius: 'var(--radius-pill, 9999px)', background: 'var(--accent, #1D4ED8)', color: 'var(--accent-text, #fff)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}
          >
            {showAddContact ? 'Close' : '+ Add regular payee'}
          </button>
        </div>

        {contactMessage && <p role="status" aria-live="polite" style={{ marginTop: '1rem', color: 'var(--success, #0F7B3F)', fontWeight: 700 }}>{contactMessage}</p>}
        {contactError && <p role="alert" style={{ marginTop: '1rem', color: 'var(--danger, #B42318)', fontWeight: 700 }}>{contactError}</p>}

        {showAddContact && (
          <form id="add-regular-payee-form" onSubmit={addRegularPayee} style={{ display: 'grid', gap: '1rem', width: '100%', maxWidth: '560px', marginTop: '1.5rem' }}>
            <div>
              <label htmlFor="regular-payee-name" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>Payee name</label>
              <input
                id="regular-payee-name"
                name="displayName"
                autoComplete="name"
                required
                maxLength={80}
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                className="form-input"
                placeholder="Name shown in the app"
                style={{ minHeight: 'var(--min-target, 64px)', width: '100%', padding: '0.75rem 1rem', font: 'inherit' }}
              />
            </div>
            <div>
              <label htmlFor="regular-payee-alias" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>Name Meena can say (optional)</label>
              <input
                id="regular-payee-alias"
                name="alias"
                maxLength={80}
                value={contactAlias}
                onChange={(event) => setContactAlias(event.target.value)}
                className="form-input"
                placeholder="Leave blank to use the payee name"
                style={{ minHeight: 'var(--min-target, 64px)', width: '100%', padding: '0.75rem 1rem', font: 'inherit' }}
              />
            </div>
            <div>
              <label htmlFor="regular-payee-email" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>PayPal Sandbox email</label>
              <input
                id="regular-payee-email"
                name="paypalEmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                className="form-input"
                placeholder="name@example.com"
                style={{ minHeight: 'var(--min-target, 64px)', width: '100%', padding: '0.75rem 1rem', font: 'inherit' }}
              />
              <p style={{ marginTop: '0.5rem', color: 'var(--text-muted, #4A4A4A)' }}>Check the email with the person before saving it.</p>
            </div>
            <button
              type="submit"
              disabled={savingContact}
              aria-busy={savingContact}
              style={{ minHeight: 'var(--min-target, 64px)', width: '100%', minWidth: '64px', padding: '0.75rem 1rem', border: '2px solid var(--accent, #1D4ED8)', borderRadius: 'var(--radius-pill, 9999px)', background: 'var(--accent, #1D4ED8)', color: 'var(--accent-text, #fff)', font: 'inherit', fontWeight: 700, cursor: savingContact ? 'wait' : 'pointer' }}
            >
              {savingContact ? 'Saving payee…' : 'Save regular payee'}
            </button>
          </form>
        )}

        {contacts.length > 0 ? (
          <ul aria-label="Saved regular payees" style={{ listStyle: 'none', marginTop: '1.5rem', padding: 0, borderTop: '1px solid var(--border, #D6D6D2)' }}>
            {contacts.map((contact) => (
              <li key={contact.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: '1rem', padding: '1rem 0', borderBottom: '1px solid var(--border, #D6D6D2)' }}>
                <div style={{ display: 'grid', gap: '0.25rem', minWidth: 0 }}>
                  <strong style={{ fontSize: '1.15rem' }}>{contact.display_name} <span style={{ color: 'var(--text-muted, #4A4A4A)', fontWeight: 500 }}>({contact.alias})</span></strong>
                  <span style={{ overflowWrap: 'anywhere' }}>{contact.paypal_email}</span>
                  <span style={{ color: contact.status === 'active' ? 'var(--success, #0F7B3F)' : 'var(--warning, #8A5A00)', fontWeight: 700 }}>
                    {contact.status === 'active'
                      ? 'Ready to use'
                      : `Safety hold until ${contact.activated_at ? new Date(contact.activated_at).toLocaleString() : 'later'}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void blockSavedContact(contact)}
                  disabled={savingBlock || changingBlockId !== null}
                  aria-label={`Block ${contact.display_name} and remove them from regular payees`}
                  style={{ minHeight: '64px', padding: '0.65rem 1rem', border: '2px solid var(--danger)', borderRadius: 'var(--radius-pill, 999px)', background: 'var(--surface)', color: 'var(--danger)', font: 'inherit', fontWeight: 700, cursor: changingBlockId ? 'wait' : 'pointer' }}
                >
                  {changingBlockId === contact.id ? 'Blocking…' : 'Block'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ marginTop: '1.5rem', color: 'var(--text-muted, #4A4A4A)' }}>No regular payees have been added yet.</p>
        )}
      </section>

      <section
        aria-labelledby="blocklist-heading"
        className="guardian-card"
        style={{ margin: '2rem 0', padding: '1.25rem', color: 'var(--text)', background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: 'var(--radius-card, 16px)', boxShadow: '0 6px 20px rgba(0, 0, 0, 0.06)' }}
      >
        <h2 id="blocklist-heading" style={{ fontSize: '1.5rem', fontWeight: 750 }}>Blocked recipients</h2>
        <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Blocked PayPal emails cannot be used for payments. Blocking a saved payee removes them from the regular payee list.
        </p>

        {blocklistError && <p role="alert" style={{ marginTop: '1rem', color: 'var(--danger)', fontWeight: 700 }}>{blocklistError}</p>}
        {blocklistMessage && <p role="status" aria-live="polite" style={{ marginTop: '1rem', color: 'var(--success)', fontWeight: 700 }}>{blocklistMessage}</p>}

        <form onSubmit={addBlockedRecipient} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', alignItems: 'end', gap: '1rem', marginTop: '1.25rem' }}>
          <div>
            <label htmlFor="blocked-recipient-email" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>PayPal email to block</label>
            <input
              id="blocked-recipient-email"
              name="paypalEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              value={blockedEmail}
              onChange={(event) => setBlockedEmail(event.target.value)}
              className="form-input"
              placeholder="name@example.com"
              style={{ minHeight: '64px', width: '100%', padding: '0.75rem 1rem', font: 'inherit' }}
            />
          </div>
          <div>
            <label htmlFor="block-reason" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>Reason (optional)</label>
            <input
              id="block-reason"
              name="reason"
              maxLength={200}
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              className="form-input"
              placeholder="Why is this recipient blocked?"
              style={{ minHeight: '64px', width: '100%', padding: '0.75rem 1rem', font: 'inherit' }}
            />
          </div>
          <button
            type="submit"
            disabled={savingBlock}
            aria-busy={savingBlock}
            style={{ minHeight: '64px', padding: '0.75rem 1rem', border: '2px solid var(--danger)', borderRadius: 'var(--radius-pill, 999px)', background: 'var(--danger)', color: 'var(--surface)', font: 'inherit', fontWeight: 750, cursor: savingBlock ? 'wait' : 'pointer' }}
          >
            {savingBlock ? 'Blocking recipient…' : 'Block recipient'}
          </button>
        </form>

        {blockedRecipients.length ? (
          <ul aria-label="Blocked PayPal recipients" style={{ listStyle: 'none', marginTop: '1.25rem', padding: 0, borderTop: '1px solid var(--border)' }}>
            {blockedRecipients.map((item) => (
              <li key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: '1rem', padding: '1rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gap: '0.3rem', minWidth: 0 }}>
                  <strong style={{ overflowWrap: 'anywhere' }}>{item.paypal_email}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>{item.reason}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void unblockRecipient(item)}
                  disabled={changingBlockId !== null || savingBlock}
                  aria-label={`Unblock ${item.paypal_email}`}
                  style={{ minHeight: '64px', padding: '0.65rem 1rem', border: '2px solid var(--border)', borderRadius: 'var(--radius-pill, 999px)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 700, cursor: changingBlockId ? 'wait' : 'pointer' }}
                >
                  {changingBlockId === item.id ? 'Unblocking…' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ marginTop: '1.25rem', color: 'var(--text-muted)' }}>No recipients are blocked.</p>
        )}
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Unblocking only removes the block. To make someone a regular payee again, add them separately and complete the safety hold.
        </p>
      </section>

      {/* Pending Approvals Action Banner */}
      {pendingApprovals.length > 0 && (
        <section
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            border: '2px solid var(--warning)',
            borderRadius: '1rem',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            <h3 style={{ color: 'var(--warning)', fontSize: '1.15rem', fontWeight: 800 }}>
              Pending Guardian Approvals ({pendingApprovals.length})
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {pendingApprovals.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: 'var(--bg-surface)',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                }}
              >
                <div>
                  <strong>{p.payee}</strong> — ${Number(p.amount).toFixed(2)}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Expires: {p.expiresAt ? new Date(p.expiresAt).toLocaleTimeString() : '30 mins'}
                  </div>
                </div>
                <a
                  href={p.url}
                  className="auth-primary-btn"
                  style={{ textDecoration: 'none', padding: '0.4rem 0.85rem', fontSize: '0.9rem' }}
                >
                  Review Decision
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AG Grid Activity Table */}
      <div className="guardian-card" style={{ padding: '1.25rem', color: 'var(--text)', background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: 'var(--radius-card, 16px)', boxShadow: '0 6px 20px rgba(0, 0, 0, 0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
            Activity & Risk Audit Log
          </h3>
          <input
            type="text"
            placeholder="Search activity..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="form-input"
            style={{ width: '220px', padding: '0.45rem 0.75rem', fontSize: '0.9rem' }}
          />
        </div>

        <div style={{ height: '460px', width: '100%' }}>
          <AgGridReact<ActivityRow>
            theme={customGridTheme}
            rowData={transactions}
            columnDefs={columnDefs}
            quickFilterText={filterText}
            rowClassRules={rowClassRules}
            pagination={true}
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 25, 50]}
            defaultColDef={{
              sortable: true,
              resizable: true,
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <div>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: 'rgba(239, 68, 68, 0.5)', marginRight: '6px', borderRadius: '2px' }} />
            Red rows indicate blocked or failed transactions
          </div>
          <a href="/" className="back-link" style={{ marginTop: 0 }}>
            ← Voice Wallet
          </a>
        </div>
      </div>
    </div>
  );
};
