import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { verifyWebhookSignature } from '../paypal/index.js';
import {
  addLedgerEntry,
  getBalance,
  createNotification,
  writeAudit,
  hasLedgerRef,
} from '../db/repository.js';
import { formatFundingNotificationHindi } from '../notifications/templates.js';

export function createWebhooksRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/paypal', async (req: Request, res: Response) => {
    try {
      const transmissionId = req.headers['paypal-transmission-id'] as string;
      const transmissionTime = req.headers['paypal-transmission-time'] as string;
      const certUrl = req.headers['paypal-cert-url'] as string;
      const authAlgo = req.headers['paypal-auth-algo'] as string;
      const transmissionSig = req.headers['paypal-transmission-sig'] as string;

      if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
        res.status(400).json({ error: 'Missing PayPal webhook verification headers' });
        return;
      }

      const isValid = await verifyWebhookSignature({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_event: req.body,
      });

      if (!isValid) {
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
      }

      const event = req.body;
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const eventId = event.id;
        const resource = event.resource;
        const captureId = resource?.id;
        const amount = parseFloat(resource?.amount?.value || '0');
        const currency = resource?.amount?.currency_code || 'INR';
        const customId = resource?.custom_id;
        const userId = customId || 'user_meena';
        const senderName = resource?.payer?.name?.given_name || 'Ramesh';

        const ref = `paypal_webhook_${eventId}`;
        if (hasLedgerRef(db, ref)) {
          res.status(200).json({ status: 'ignored_duplicate', eventId });
          return;
        }

        addLedgerEntry(db, {
          user_id: userId,
          delta: amount,
          reason: `PayPal received (${senderName})`,
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
          kind: 'paypal_webhook_processed',
          payload: JSON.stringify({ eventId, captureId, amount, currency, newBalance }),
        });

        res.status(200).json({ status: 'success', eventId, amount, balance: newBalance });
        return;
      }

      res.status(200).json({ status: 'ignored_event_type', eventType: event.event_type });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
