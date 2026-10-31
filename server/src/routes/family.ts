import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import crypto from 'node:crypto';
import { createOrder, captureOrder, getPayPalBalances, PayPalError } from '../paypal/index.js';
import {
  addLedgerEntry,
  getUserById,
  createNotification,
  writeAudit,
  hasLedgerRef,
  listContacts,
  upsertContact,
} from '../db/repository.js';
import type { ContactStatus } from '../db/types.js';
import { formatFundingNotificationHindi } from '../notifications/templates.js';
import { refreshPayoutStatus } from '../payments/pipeline.js';
import { config } from '../config.js';
import { clearFamilySession, hasFamilySession, issueFamilySession, requireFamilyAuth, verifyFamilyCredentials } from '../auth/familyAuth.js';
import { requireAuth } from '../auth/middleware.js';

export function createFamilyRouter(db: Database): Router {
  const router = Router();

  router.get('/session', async (req: Request, res: Response) => {
    res.status(200).json({ authenticated: hasFamilySession(req) });
  });

  router.post('/login', async (req: Request, res: Response) => {
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

  router.post('/logout', async (req: Request, res: Response) => {
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
      const inFlight = await db.query<{ id: string }>(
        "SELECT id FROM transactions WHERE user_id = $1 AND status = 'processing' AND paypal_ref IS NOT NULL", [uid]);
      const paypalStatusByTransaction = new Map<string, string>();
      await Promise.all(inFlight.map(async ({ id }) => {
        const refreshed = await refreshPayoutStatus(db, id);
        if (refreshed.paypalStatus) paypalStatusByTransaction.set(id, refreshed.paypalStatus);
      }));

      // Re-read after status refresh so the activity list reflects any completion/failure found above.
      const rows = await db.query<import('../db/types.js').Transaction & { approval_status: string | null; payee_name: string | null }>(
        `SELECT t.*, t.amount::float8 AS amount, COALESCE(c.display_name, m.name) AS payee_name,
          (SELECT a.status FROM approvals a WHERE a.transaction_id = t.id ORDER BY a.created_at DESC LIMIT 1) AS approval_status
         FROM transactions t LEFT JOIN contacts c ON t.counterparty_type = 'contact' AND c.id = t.counterparty_id
         LEFT JOIN merchants m ON t.counterparty_type = 'merchant' AND m.id = t.counterparty_id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC`, [uid]);
      const transactions = rows.map((tx) => {
        const counterparty = tx.payee_name || tx.counterparty_id;
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

  router.post('/contacts', async (req: Request, res: Response) => {
    try {
      const userId = 'user_meena';
      const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
      const alias = typeof req.body.alias === 'string' ? req.body.alias.trim() : displayName;
      const paypalEmail = typeof req.body.paypalEmail === 'string' ? req.body.paypalEmail.trim() : '';

      if (
        !displayName || displayName.length > 80 || !alias || alias.length > 80
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail) || paypalEmail.length > 254
      ) {
        res.status(400).json({ error: 'Enter a payee name, spoken nickname, and valid PayPal Sandbox email' });
        return;
      }

      const duplicate = (await db.query<{ id: string }>(`
        SELECT id FROM contacts WHERE user_id = $1 AND (
          LOWER(paypal_email) = LOWER($2) OR LOWER(alias) = LOWER($3) OR LOWER(display_name) = LOWER($4)
        ) LIMIT 1
      `, [userId, paypalEmail, alias, displayName]))[0];
      if (duplicate) {
        res.status(409).json({ error: 'A saved payee already uses that email, name, or nickname.' });
        return;
      }

      const now = new Date();
      const skipCooling = process.env.DEMO_SKIP_COOLING === 'true';
      const coolingHoursRaw = Number.parseInt(process.env.CONTACT_COOLING_OFF_HOURS || '24', 10);
      const coolingHours = Number.isFinite(coolingHoursRaw) ? Math.max(1, Math.min(coolingHoursRaw, 168)) : 24;
      const status: ContactStatus = skipCooling ? 'active' : 'cooling_off';
      const activatedAt = skipCooling
        ? now.toISOString()
        : new Date(now.getTime() + coolingHours * 60 * 60 * 1000).toISOString();
      const guardianId = (await db.query<{ id: string }>(
        'SELECT id FROM guardians WHERE user_id = $1 ORDER BY id LIMIT 1', [userId]))[0]?.id || 'guardian_family_dashboard';
      const contact = await upsertContact(db, {
        id: `contact_${crypto.randomUUID().slice(0, 8)}`,
        user_id: userId,
        alias,
        display_name: displayName,
        paypal_email: paypalEmail,
        status,
        added_by: guardianId,
        activated_at: activatedAt,
      });

      await createNotification(db, {
        user_id: userId,
        kind: 'contact_added',
        message: `Family added ${displayName} (${paypalEmail}) to regular payees. Status: ${status}.`,
        spoken_text: `Aapki family ne ${displayName} ko regular payee list mein joda hai.`,
      });
      await writeAudit(db, {
        user_id: userId,
        kind: 'family_contact_added',
        payload: JSON.stringify({ contactId: contact.id, displayName, alias, paypalEmail, status, activatedAt }),
      });

      res.status(201).json({ contact, inCoolingOff: status === 'cooling_off', coolingHours });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

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
      const user = await getUserById(db, uid);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const processingTransactions = await db.query<{ id: string }>(
        "SELECT id FROM transactions WHERE user_id = $1 AND status = 'processing' AND paypal_ref IS NOT NULL", [uid]);
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
      const txRows = await db.query<import('../db/types.js').Transaction & { payee_name: string | null }>(
        `SELECT t.*, t.amount::float8 AS amount, COALESCE(c.display_name, m.name) AS payee_name
         FROM transactions t LEFT JOIN contacts c ON t.counterparty_type = 'contact' AND c.id = t.counterparty_id
         LEFT JOIN merchants m ON t.counterparty_type = 'merchant' AND m.id = t.counterparty_id
         WHERE t.user_id = $1 ORDER BY t.created_at DESC`, [uid]);

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
          counterparty: tx.payee_name || tx.counterparty_id,
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
      const pendingRows = await db.query<import('../db/types.js').Approval & { amount: number; counterparty_id: string; counterparty_type: string; payee_name: string | null }>(`
          SELECT a.*, t.amount::float8 AS amount, t.counterparty_id, t.counterparty_type, COALESCE(c.display_name, m.name) AS payee_name
          FROM approvals a JOIN transactions t ON a.transaction_id = t.id
          LEFT JOIN contacts c ON t.counterparty_type = 'contact' AND c.id = t.counterparty_id
          LEFT JOIN merchants m ON t.counterparty_type = 'merchant' AND m.id = t.counterparty_id
          WHERE t.user_id = $1 AND a.status = 'pending' ORDER BY a.created_at DESC
        `, [uid]);

      const pendingApprovals = pendingRows.map((p) => ({
        id: p.id,
        token: p.token,
        amount: p.amount,
        payee: p.payee_name || p.counterparty_id,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        url: `/approve/${p.token}`,
      }));

      res.status(200).json({
        success: true,
        userName: user.name,
        limits,
        contacts: await listContacts(db, uid),
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

      const user = await getUserById(db, userId);
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

        if (!await hasLedgerRef(db, ref)) {
          await addLedgerEntry(db, {
            user_id: userId,
            delta: amount,
            reason: `Family funding (${senderName})`,
            ref,
          });

          const currency = captureDetails?.amount?.currency_code || 'USD';
          const spokenText = formatFundingNotificationHindi(senderName, amount, currency);

          await createNotification(db, {
            user_id: userId,
            kind: 'received_money',
            message: `Received ${amount} from ${senderName}`,
            spoken_text: spokenText,
          });

          await writeAudit(db, {
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

  router.post('/emergency-limit', async (req: Request, res: Response) => {
    try {
      const { additionalDailyLimit = 5000, perPaymentLimit = 5000 } = req.body;
      const userId = 'user_meena';
      const user = await getUserById(db, userId);
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

      await db.query('UPDATE users SET limits = $1::jsonb WHERE id = $2', [JSON.stringify(limits), userId]);

      await createNotification(db, {
        user_id: userId,
        kind: 'emergency_limit_granted',
        message: `Emergency limit is now $${limits.daily_total} per day.`,
        spoken_text: `Aapki daily spending limit ab ${limits.daily_total} US dollars hai.`,
      });

      await writeAudit(db, {
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
