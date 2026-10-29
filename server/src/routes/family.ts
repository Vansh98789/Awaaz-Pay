import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { createOrder, captureOrder } from '../paypal/index.js';
import {
  addLedgerEntry,
  getBalance,
  getUserById,
  createNotification,
  writeAudit,
  hasLedgerRef,
} from '../db/repository.js';
import { formatFundingNotificationHindi } from '../notifications/templates.js';

export function createFamilyRouter(db: Database.Database): Router {
  const router = Router();

  // Dashboard endpoint for AG Grid Family Dashboard
  router.get('/dashboard', (req: Request, res: Response) => {
    try {
      const { userId = 'user_meena' } = req.query;
      const uid = String(userId);
      const user = getUserById(db, uid);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const balance = getBalance(db, uid);

      let limits = {
        daily_total: 1000,
        per_transaction_new_payee: 500,
        max_new_payees_per_day: 2,
      };
      try {
        limits = JSON.parse(user.limits);
      } catch {
        // default
      }

      // 1. Fetch all transactions
      const txRows = db
        .prepare<[string], import('../db/types.js').Transaction>(
          'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC'
        )
        .all(uid);

      // 2. Fetch all wallet_ledger rows for funding/deposits
      const ledgerRows = db
        .prepare<[string], import('../db/types.js').LedgerEntry>(
          'SELECT * FROM wallet_ledger WHERE user_id = ? AND delta > 0 ORDER BY created_at DESC'
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
          isFlagged,
        };
      });

      const formattedDeposits = ledgerRows.map((l) => ({
        id: l.id,
        time: l.created_at,
        direction: 'IN',
        counterparty: l.reason.replace(/Family funding \((.*?)\)/, '$1') || 'Funding',
        counterpartyType: 'funding',
        amount: l.delta,
        currency: 'INR',
        tier: 'Deposit',
        riskScore: 0,
        risk: 'Low',
        decision: 'allow',
        status: 'completed',
        paypalRef: l.ref,
        isFlagged: false,
      }));

      const allActivity = [...formattedTx, ...formattedDeposits].sort(
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
        balance,
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
      const { amount, currency = 'USD', userId = 'user_meena' } = req.body;
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
      const { orderId, userId = 'user_meena', senderName = 'Ramesh' } = req.body;
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

          const newBalance = getBalance(db, userId);
          const spokenText = formatFundingNotificationHindi(senderName, amount, newBalance);

          createNotification(db, {
            user_id: userId,
            kind: 'received_money',
            message: `Received ${amount} from ${senderName}`,
            spoken_text: spokenText,
          });

          writeAudit(db, {
            user_id: userId,
            kind: 'family_fund_captured',
            payload: JSON.stringify({ orderId, captureId, amount, newBalance }),
          });

          res.status(200).json({
            status: 'COMPLETED',
            captureId,
            amount,
            balance: newBalance,
          });
          return;
        }

        res.status(200).json({
          status: 'COMPLETED',
          captureId,
          balance: getBalance(db, userId),
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
      const { userId = 'user_meena', additionalDailyLimit = 5000, perPaymentLimit = 5000 } = req.body;
      const user = getUserById(db, userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      let limits = { daily_total: 1000, per_transaction_new_payee: 500, max_new_payees_per_day: 2 };
      try {
        limits = JSON.parse(user.limits);
      } catch {
        // default
      }

      limits.daily_total += Number(additionalDailyLimit);
      limits.per_transaction_new_payee = Math.max(limits.per_transaction_new_payee, Number(perPaymentLimit));

      db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(JSON.stringify(limits), userId);

      createNotification(db, {
        user_id: userId,
        kind: 'emergency_limit_granted',
        message: `Emergency limit increased by ₹${additionalDailyLimit}. New daily limit: ₹${limits.daily_total}.`,
        spoken_text: `Ramesh ji ne aapki kharch karne ki limit badha di gayi hai. Nayi limit ₹${limits.daily_total} hai.`,
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
