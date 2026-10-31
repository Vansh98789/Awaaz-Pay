import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { createOrder, captureOrder, getPayPalBalances, PayPalError } from '../paypal/index.js';
import {
  addLedgerEntry,
  getUserById,
  createNotification,
  writeAudit,
  hasLedgerRef,
} from '../db/repository.js';
import { formatFundingNotificationHindi } from '../notifications/templates.js';
import { refreshPayoutStatus } from '../payments/pipeline.js';
import { config } from '../config.js';
import { clearFamilySession, hasFamilySession, issueFamilySession, requireFamilyAuth, verifyFamilyCredentials } from '../auth/familyAuth.js';
import { requireAuth } from '../auth/middleware.js';

export function createFamilyRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/session', (req: Request, res: Response) => {
    res.status(200).json({ authenticated: hasFamilySession(req) });
  });

  router.post('/login', (req: Request, res: Response) => {
    if (!config.FAMILY_DASHBOARD_EMAIL || !config.FAMILY_DASHBOARD_PASSWORD) {
      res.status(503).json({ error: 'Family portal login is not configured. Set FAMILY_DASHBOARD_EMAIL and FAMILY_DASHBOARD_PASSWORD.' });
      return;
    }
    if (!verifyFamilyCredentials(req.body?.email, req.body?.password)) {
      res.status(401).json({ error: 'Email or password is incorrect.' });
      return;
    }
    issueFamilySession(res);
    res.status(200).json({ success: true });
  });

  router.post('/logout', (req: Request, res: Response) => {
    clearFamilySession(req, res);
    res.status(200).json({ success: true });
  });

  // Voice-wallet reads use the blind user's own app session, separately from
  // the guardian portal session.
  router.get('/wallet-paypal-balance', requireAuth, async (_req: Request, res: Response) => {
    try {
      const result = await getPayPalBalances('USD');
      const usd = result.balances.find((balance) => balance.currency === 'USD');
      res.status(200).json({
        success: true,
        currency: 'USD',
        total: usd?.total_balance.value ?? '0.00',
        available: usd?.available_balance.value ?? '0.00',
        asOf: result.as_of_time ?? result.last_refresh_time ?? null,
        accountEmail: config.PAYPAL_SANDBOX_MERCHANT_EMAIL || null,
        source: 'paypal_sandbox',
        note: 'PayPal reporting balances may take up to three hours to refresh.',
      });
    } catch (err) {
      const paypalDenied = err instanceof PayPalError && err.status === 403;
      res.status(502).json({
        success: false,
        error: paypalDenied
          ? 'PayPal denied balance access. Enable the List Balances or Transaction Search reporting permission for this Sandbox REST app, then restart Awaaz Pay.'
          : (err as Error).message,
        code: 'PAYPAL_BALANCE_UNAVAILABLE',
      });
    }
  });

  router.get('/wallet-activity', requireAuth, async (req: Request, res: Response) => {
    try {
      const uid = req.user?.id || 'user_meena';
      const inFlight = db.prepare<[string], { id: string }>(
        "SELECT id FROM transactions WHERE user_id = ? AND status = 'processing' AND paypal_ref IS NOT NULL"
      ).all(uid);
      const paypalStatusByTransaction = new Map<string, string>();
      await Promise.all(inFlight.map(async ({ id }) => {
        const refreshed = await refreshPayoutStatus(db, id);
        if (refreshed.paypalStatus) paypalStatusByTransaction.set(id, refreshed.paypalStatus);
      }));

      // Re-read after status refresh so the activity list reflects any completion/failure found above.
      const rows = db.prepare<[string], import('../db/types.js').Transaction & { approval_status: string | null }>(
        `SELECT t.*,
          (SELECT a.status FROM approvals a WHERE a.transaction_id = t.id ORDER BY a.created_at DESC LIMIT 1) AS approval_status
         FROM transactions t WHERE t.user_id = ? ORDER BY t.created_at DESC`
      ).all(uid);
      const transactions = rows.map((tx) => {
        let counterparty = tx.counterparty_id;
        if (tx.counterparty_type === 'contact') {
          counterparty = db.prepare<[string], { display_name: string }>('SELECT display_name FROM contacts WHERE id = ?').get(tx.counterparty_id)?.display_name || counterparty;
        } else if (tx.counterparty_type === 'merchant') {
          counterparty = db.prepare<[string], { name: string }>('SELECT name FROM merchants WHERE id = ?').get(tx.counterparty_id)?.name || counterparty;
        }
        return {
          id: tx.id,
          time: tx.created_at,
          direction: 'OUT',
          counterparty,
          amount: tx.amount,
          currency: tx.currency,
          status: tx.status,
          paypalRef: tx.paypal_ref,
          paypalStatus: paypalStatusByTransaction.get(tx.id),
          approvalStatus: tx.approval_status,
        };
      });
      res.status(200).json({ success: true, transactions });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Family data and actions always require the separate guardian session.
  // This intentionally does not honor DEMO_AUTH_BYPASS.
  router.use(requireFamilyAuth);

  // The displayed account balance is the PayPal Business Sandbox sender balance.
  router.get('/paypal-balance', async (_req: Request, res: Response) => {
    try {
      const result = await getPayPalBalances('USD');
      const usd = result.balances.find((balance) => balance.currency === 'USD');
      res.status(200).json({
        success: true,
        currency: 'USD',
        total: usd?.total_balance.value ?? '0.00',
        available: usd?.available_balance.value ?? '0.00',
        asOf: result.as_of_time ?? result.last_refresh_time ?? null,
        accountEmail: config.PAYPAL_SANDBOX_MERCHANT_EMAIL || null,
        source: 'paypal_sandbox',
        note: 'PayPal reporting balances may take up to three hours to refresh.',
      });
    } catch (err) {
      const paypalDenied = err instanceof PayPalError && err.status === 403;
      res.status(502).json({
        success: false,
        error: paypalDenied
          ? 'PayPal denied balance access. Enable the List Balances or Transaction Search reporting permission for this Sandbox REST app, then restart Awaaz Pay.'
          : (err as Error).message,
        code: 'PAYPAL_BALANCE_UNAVAILABLE',
      });
    }
  });

  // Dashboard endpoint for AG Grid Family Dashboard
  router.get('/dashboard', async (_req: Request, res: Response) => {
    try {
      const uid = 'user_meena';
      const user = getUserById(db, uid);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const processingTransactions = db
        .prepare<[string], { id: string }>(
          "SELECT id FROM transactions WHERE user_id = ? AND status = 'processing' AND paypal_ref IS NOT NULL"
        )
        .all(uid);
      const paypalStatusByTransaction = new Map<string, string>();
      await Promise.all(processingTransactions.map(async (tx) => {
        const refreshed = await refreshPayoutStatus(db, tx.id);
        if (refreshed.paypalStatus) paypalStatusByTransaction.set(tx.id, refreshed.paypalStatus);
      }));

      let limits = {
        daily_total: 5000,
        per_transaction_new_payee: 500,
        max_new_payees_per_day: 2,
      };
      try {
        limits = JSON.parse(user.limits);
      } catch {
        // default
      }
      limits.daily_total = Math.min(Number(limits.daily_total) || 5000, 5000);

      // 1. Fetch all transactions
      const txRows = db
        .prepare<[string], import('../db/types.js').Transaction>(
          'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC'
        )
        .all(uid);

      const formatCounterparty = (type: string, id: string) => {
        if (type === 'contact') {
          const c = db
            .prepare<[string], { display_name: string }>('SELECT display_name FROM contacts WHERE id = ?')
            .get(id);
          if (c) return c.display_name;
        } else if (type === 'merchant') {
          const m = db
            .prepare<[string], { name: string }>('SELECT name FROM merchants WHERE id = ?')
            .get(id);
          if (m) return m.name;
        }
        return id;
      };

      const formattedTx = txRows.map((tx) => {
        const isFlagged =
          tx.decision === 'block' ||
          tx.decision === 'need_guardian_approval' ||
          tx.risk_score >= 0.5 ||
          tx.status === 'failed';

        return {
          id: tx.id,
          time: tx.created_at,
          direction: 'OUT',
          counterparty: formatCounterparty(tx.counterparty_type, tx.counterparty_id),
          counterpartyType: tx.counterparty_type,
          amount: tx.amount,
          currency: tx.currency,
          tier: `Tier ${tx.tier}`,
          riskScore: tx.risk_score,
          risk: tx.risk_score >= 0.8 ? 'High' : tx.risk_score >= 0.4 ? 'Medium' : 'Low',
          decision: tx.decision,
          status: tx.status,
          paypalRef: tx.paypal_ref,
          paypalStatus: paypalStatusByTransaction.get(tx.id),
          isFlagged,
        };
      });

      const allActivity = formattedTx.sort(
        (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
      );

      // 3. Pending approvals list
      const pendingRows = db
        .prepare<[string], import('../db/types.js').Approval & { amount: number; counterparty_id: string; counterparty_type: string }>(`
          SELECT a.*, t.amount, t.counterparty_id, t.counterparty_type
          FROM approvals a
          JOIN transactions t ON a.transaction_id = t.id
          WHERE t.user_id = ? AND a.status = 'pending'
          ORDER BY a.created_at DESC
        `)
        .all(uid);

      const pendingApprovals = pendingRows.map((p) => ({
        id: p.id,
        token: p.token,
        amount: p.amount,
        payee: formatCounterparty(p.counterparty_type, p.counterparty_id),
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        url: `/approve/${p.token}`,
      }));

      res.status(200).json({
        success: true,
        userName: user.name,
        limits,
        transactions: allActivity,
        pendingApprovals,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/fund-order', async (req: Request, res: Response) => {
    try {
      const { amount, currency = 'USD' } = req.body;
      const userId = 'user_meena';
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ error: 'Valid positive amount is required' });
        return;
      }

      const user = getUserById(db, userId);
      const description = `Family wallet funding for ${user?.name ?? 'user'}`;
      const idempotencyKey =
        (req.headers['paypal-request-id'] as string) || `fund-${Date.now()}`;

      const order = await createOrder({
        amount,
        currency,
        description,
        idempotencyKey,
      });

      const approvalUrl = order.links.find((l) => l.rel === 'approve')?.href ?? null;
      res.status(200).json({
        orderId: order.id,
        approvalUrl,
        status: order.status,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/capture', async (req: Request, res: Response) => {
    try {
      const { orderId, senderName = 'Ramesh' } = req.body;
      const userId = 'user_meena';
      if (!orderId || typeof orderId !== 'string') {
        res.status(400).json({ error: 'orderId is required' });
        return;
      }

      const capture = await captureOrder(orderId);
      const captureDetails = capture.purchase_units?.[0]?.payments?.captures?.[0];
      const captureId = captureDetails?.id || orderId;
      const status = capture.status || captureDetails?.status || 'COMPLETED';

      if (status === 'COMPLETED') {
        const amount = captureDetails?.amount?.value
          ? parseFloat(captureDetails.amount.value)
          : req.body.amount || 0;
        const ref = `paypal_capture_${captureId}`;

        if (!hasLedgerRef(db, ref)) {
          addLedgerEntry(db, {
            user_id: userId,
            delta: amount,
            reason: `Family funding (${senderName})`,
            ref,
          });

          const currency = captureDetails?.amount?.currency_code || 'USD';
          const spokenText = formatFundingNotificationHindi(senderName, amount, currency);

          createNotification(db, {
            user_id: userId,
            kind: 'received_money',
            message: `Received ${amount} from ${senderName}`,
            spoken_text: spokenText,
          });

          writeAudit(db, {
            user_id: userId,
            kind: 'family_fund_captured',
            payload: JSON.stringify({ orderId, captureId, amount, currency }),
          });

          res.status(200).json({
            status: 'COMPLETED',
            captureId,
            amount,
            currency,
          });
          return;
        }

        res.status(200).json({
          status: 'COMPLETED',
          captureId,
          currency: captureDetails?.amount?.currency_code || 'USD',
          alreadyProcessed: true,
        });
        return;
      }

      res.status(200).json({ status });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/emergency-limit', (req: Request, res: Response) => {
    try {
      const { additionalDailyLimit = 5000, perPaymentLimit = 5000 } = req.body;
      const userId = 'user_meena';
      const user = getUserById(db, userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      let limits = { daily_total: 5000, per_transaction_new_payee: 500, max_new_payees_per_day: 2 };
      try {
        limits = JSON.parse(user.limits);
      } catch {
        // default
      }

      limits.daily_total = Math.min(5000, limits.daily_total + Number(additionalDailyLimit));
      limits.per_transaction_new_payee = Math.max(limits.per_transaction_new_payee, Number(perPaymentLimit));

      db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(JSON.stringify(limits), userId);

      createNotification(db, {
        user_id: userId,
        kind: 'emergency_limit_granted',
        message: `Emergency limit is now $${limits.daily_total} per day.`,
        spoken_text: `Aapki daily spending limit ab ${limits.daily_total} US dollars hai.`,
      });

      writeAudit(db, {
        user_id: userId,
        kind: 'emergency_limit_granted',
        payload: JSON.stringify({ userId, additionalDailyLimit, limits }),
      });

      res.status(200).json({
        success: true,
        limits,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
