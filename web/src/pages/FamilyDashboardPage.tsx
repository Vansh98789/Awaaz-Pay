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

interface LimitsData {
  daily_total: number;
  per_transaction_new_payee: number;
  max_new_payees_per_day: number;
}

const customGridTheme = themeQuartz.withParams({
  backgroundColor: '#18181A',
  foregroundColor: '#F4F4F2',
  headerBackgroundColor: '#0E0E0F',
  headerTextColor: '#8AAEFF',
  borderColor: '#35353A',
  rowHoverColor: '#27272a',
  fontFamily: 'var(--font-sans)',
});

export const FamilyDashboardPage: React.FC = () => {
  const [userName, setUserName] = useState<string>('Meena');
  const [balance, setBalance] = useState<number>(0);
  const [paypalBalance, setPaypalBalance] = useState<{ available: string; total: string; asOf: string | null } | null>(null);
  const [paypalBalanceError, setPaypalBalanceError] = useState<string | null>(null);
  const [limits, setLimits] = useState<LimitsData>({
    daily_total: 1000,
    per_transaction_new_payee: 500,
    max_new_payees_per_day: 2,
  });
  const [transactions, setTransactions] = useState<ActivityRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>('');
  const [emergencyMessage, setEmergencyMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
    fetchPayPalBalance();
  }, []);

  const fetchPayPalBalance = async () => {
    try {
      setPaypalBalanceError(null);
      const res = await fetch('/api/family/paypal-balance');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'PayPal balance is unavailable');
      setPaypalBalance({ available: data.available, total: data.total, asOf: data.asOf });
    } catch (err) {
      setPaypalBalance(null);
      setPaypalBalanceError((err as Error).message);
    }
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/family/dashboard?userId=user_meena');
      if (!res.ok) {
        throw new Error('Failed to load family dashboard');
      }
      const data = await res.json();
      setUserName(data.userName || 'Meena');
      setBalance(data.balance ?? 0);
      if (data.limits) setLimits(data.limits);
      setTransactions(data.transactions || []);
      setPendingApprovals(data.pendingApprovals || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGrantEmergencyLimit = async () => {
    try {
      setEmergencyMessage(null);
      const res = await fetch('/api/family/emergency-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user_meena',
          additionalDailyLimit: 5000,
          perPaymentLimit: 5000,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to grant emergency limit');
      }

      const data = await res.json();
      setLimits(data.limits);
      setEmergencyMessage('✅ Emergency limit granted: +₹5,000 added to daily limit.');
      fetchDashboardData();
    } catch (err) {
      setError((err as Error).message);
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
        valueFormatter: (params) => `₹${Number(params.value).toLocaleString('en-IN')}`,
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
          const isPending = s === 'pending' || s === 'processing' || s === 'confirmed';
          const color = isDone ? '#4ade80' : isFailed ? '#f87171' : isPending ? '#fbbf24' : '#94a3b8';
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
        params.data?.decision === 'need_guardian_approval' || params.data?.status === 'confirmed',
      'flagged-row': (params) => Boolean(params.data?.isFlagged),
    }),
    []
  );

  return (
    <div className="guardian-page-container" style={{ maxWidth: '980px' }}>
      <header className="guardian-header">
        <h1>🛡️ Awaaz Pay · Family Activity Dashboard</h1>
        <p className="guardian-subtitle">Guardian Oversight & Real-Time Security Monitoring (AG Grid)</p>
      </header>

      {loading && (
        <div className="guardian-card loading" style={{ marginBottom: '1rem', padding: '1.25rem' }}>
          ⏳ Loading activity and security data...
        </div>
      )}

      {/* Summary Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div className="guardian-card" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>User Profile</span>
          <h3 style={{ fontSize: '1.25rem', marginTop: '0.25rem' }}>{userName}</h3>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Voice-first wallet</span>
        </div>

        <div className="guardian-card" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Wallet Balance</span>
          <h3 style={{ fontSize: '1.35rem', color: '#34d399', marginTop: '0.25rem' }}>
            ₹{balance.toLocaleString('en-IN')}
          </h3>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            Awaaz Pay ledger, not the PayPal account balance. Sandbox only; no real money.
          </span>
        </div>

        <div className="guardian-card" style={{ padding: '1rem' }} aria-live="polite">
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>PayPal Sandbox Balance · USD</span>
          {paypalBalance ? (
            <>
              <h3 style={{ fontSize: '1.35rem', color: '#34d399', marginTop: '0.25rem' }}>
                ${Number(paypalBalance.available).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} available
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                Total: ${Number(paypalBalance.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {paypalBalance.asOf ? ` · PayPal report as of ${new Date(paypalBalance.asOf).toLocaleString()}` : ''}
              </span>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: '1rem', marginTop: '0.25rem' }}>Unavailable</h3>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {paypalBalanceError || 'Loading PayPal balance…'} PayPal reporting can lag by up to 3 hours.
              </span>
              <button type="button" onClick={fetchPayPalBalance} className="auth-secondary-btn" style={{ marginTop: '0.5rem', minHeight: '44px' }}>
                Refresh PayPal balance
              </button>
            </>
          )}
        </div>

        <div className="guardian-card" style={{ padding: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Daily Spend Cap</span>
          <h3 style={{ fontSize: '1.25rem', marginTop: '0.25rem' }}>
            ₹{limits.daily_total.toLocaleString('en-IN')}
          </h3>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            ₹{limits.per_transaction_new_payee} per new payee
          </span>
        </div>

        <div className="guardian-card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <button
            type="button"
            className="auth-secondary-btn"
            onClick={handleGrantEmergencyLimit}
            style={{ fontSize: '0.85rem', padding: '0.6rem 0.75rem' }}
          >
            ⚡ Emergency +₹5,000 Limit
          </button>
        </div>
      </div>

      {emergencyMessage && (
        <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22c55e', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', color: '#86efac' }}>
          {emergencyMessage}
        </div>
      )}

      {error && <p className="error-banner">⚠️ {error}</p>}

      {/* Pending Approvals Action Banner */}
      {pendingApprovals.length > 0 && (
        <section
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            border: '2px solid #f59e0b',
            borderRadius: '1rem',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            <h3 style={{ color: '#fbbf24', fontSize: '1.15rem', fontWeight: 800 }}>
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
                  <strong>{p.payee}</strong> — ₹{p.amount}
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
      <div className="guardian-card" style={{ padding: '1.25rem' }}>
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
