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

  return router;
}
