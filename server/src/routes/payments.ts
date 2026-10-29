import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { evaluatePayment } from '../rules/engine.js';
import type { PaymentRequest, ScamRiskLevel } from '../rules/types.js';
import { createPayoutBatch, getPayoutBatch } from '../paypal/index.js';
import {
  addLedgerEntry,
  getBalance,
  getTransactionById,
  getUserById,
  recordTransaction,
  updateTransactionStatus,
  writeAudit,
} from '../db/repository.js';
import { resolvePayee, buildPaymentContext } from '../payments/context.js';

function generateReadbackText(
  displayName: string,
  amount: number,
  currency = 'INR',
  lang = 'hi'
): string {
  if (lang === 'en') {
    return `Sending ₹${amount} to ${displayName}. No extra fees apply. Please say yes to confirm.`;
  }
  return `${displayName} ko ${amount} rupaye bheje ja rahe hain. Koi extra fee nahi hai. Kripya confirm karein.`;
}

export function createPaymentsRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/prepare', (req: Request, res: Response) => {
    try {
      const {
        userId = 'user_meena',
        payee,
        amount,
        currency = 'INR',
        scamRisk = 'low',
      } = req.body;

      if (!payee || typeof payee !== 'string') {
        res.status(400).json({ error: 'Payee is required' });
        return;
      }
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ error: 'Valid positive amount is required' });
        return;
      }

      const user = getUserById(db, userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const resolvedPayee = resolvePayee(db, userId, payee);
      const { context } = buildPaymentContext(
        db,
        user,
        resolvedPayee,
        scamRisk as ScamRiskLevel
      );

      const paymentRequest: PaymentRequest = {
        amount,
        currency,
        payeeType: resolvedPayee.payeeType,
        payeeId: resolvedPayee.counterpartyId,
        payeeName: resolvedPayee.displayName,
      };

      const decision = evaluatePayment(paymentRequest, context);

      let status = 'pending_confirmation';
      if (decision.action === 'need_guardian_approval') {
        status = 'awaiting_approval';
      } else if (decision.action === 'block') {
        status = 'failed';
      }

      const tx = recordTransaction(db, {
        user_id: userId,
        type: 'send_money',
        amount,
        currency,
        counterparty_type: resolvedPayee.counterpartyType,
        counterparty_id: resolvedPayee.counterpartyId,
        tier: decision.tier,
        risk_score: scamRisk === 'high' ? 0.9 : scamRisk === 'medium' ? 0.5 : 0.1,
        decision: decision.action,
        status,
      });

      writeAudit(db, {
        user_id: userId,
        kind: 'payment_prepared',
        payload: JSON.stringify({
          transactionId: tx.id,
          payee: resolvedPayee.displayName,
          amount,
          decision: decision.action,
          tier: decision.tier,
        }),
      });

      const readbackText = generateReadbackText(
        resolvedPayee.displayName,
        amount,
        currency,
        user.language
      );

      res.status(200).json({
        transactionId: tx.id,
        decision,
        readbackText,
        payee: resolvedPayee.displayName,
        payeeEmail: resolvedPayee.email,
        amount,
        status: tx.status,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/confirm', async (req: Request, res: Response) => {
    try {
      const { transactionId, userConfirmed } = req.body;
      if (!transactionId || typeof transactionId !== 'string') {
        res.status(400).json({ error: 'transactionId is required' });
        return;
      }

      const tx = getTransactionById(db, transactionId);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (tx.status === 'completed') {
        res.status(200).json({
          status: 'completed',
          alreadyPaid: true,
          transactionId: tx.id,
          message: 'Payment already completed.',
        });
        return;
      }

      if (tx.status === 'processing') {
        res.status(200).json({
          status: 'processing',
          transactionId: tx.id,
          message: 'Payment is currently processing.',
        });
        return;
      }

      if (tx.decision !== 'allow_with_confirmation' && tx.status !== 'pending_confirmation') {
        res.status(400).json({
          error: `Cannot confirm transaction with decision: ${tx.decision} and status: ${tx.status}`,
          spoken_message: 'This payment cannot be confirmed directly.',
        });
        return;
      }

      if (!userConfirmed) {
        updateTransactionStatus(db, tx.id, 'cancelled');
        writeAudit(db, {
          user_id: tx.user_id,
          kind: 'payment_cancelled',
          payload: JSON.stringify({ transactionId: tx.id }),
        });
        res.status(200).json({
          status: 'cancelled',
          transactionId: tx.id,
          message: 'Payment cancelled.',
        });
        return;
      }

      const balance = getBalance(db, tx.user_id);
      if (balance < tx.amount) {
        updateTransactionStatus(db, tx.id, 'failed');
        writeAudit(db, {
          user_id: tx.user_id,
          kind: 'payment_insufficient_funds',
          payload: JSON.stringify({
            transactionId: tx.id,
            balance,
            requiredAmount: tx.amount,
          }),
        });
        res.status(400).json({
          error: 'Insufficient balance',
          spoken_message: 'Aapke wallet mein paryapt balance nahi hai.',
          balance,
          requiredAmount: tx.amount,
        });
        return;
      }

      addLedgerEntry(db, {
        user_id: tx.user_id,
        delta: -tx.amount,
        reason: `Payment reservation for tx ${tx.id}`,
        ref: `res_${tx.id}`,
      });

      updateTransactionStatus(db, tx.id, 'processing');
      writeAudit(db, {
        user_id: tx.user_id,
        kind: 'payment_confirmed_processing',
        payload: JSON.stringify({ transactionId: tx.id, amount: tx.amount }),
      });

      let recipientEmail = 'receiver@sandbox.paypal.com';
      if (tx.counterparty_type === 'contact') {
        const c = db
          .prepare<[string], { paypal_email: string }>('SELECT paypal_email FROM contacts WHERE id = ?')
          .get(tx.counterparty_id);
        if (c?.paypal_email) recipientEmail = c.paypal_email;
      } else if (tx.counterparty_type === 'merchant') {
        const m = db
          .prepare<[string], { paypal_email: string }>('SELECT paypal_email FROM merchants WHERE id = ?')
          .get(tx.counterparty_id);
        if (m?.paypal_email) recipientEmail = m.paypal_email;
      } else if (tx.counterparty_id.includes('@')) {
        recipientEmail = tx.counterparty_id;
      }

      try {
        const payoutBatch = await createPayoutBatch([
          {
            recipient_email: recipientEmail,
            amount: tx.amount,
            currency: tx.currency === 'INR' ? 'USD' : tx.currency,
            note: `Payment from Awaaz Pay user`,
            sender_item_id: tx.id,
          },
        ]);

        const batchId = payoutBatch.batch_header?.payout_batch_id || `batch-${Date.now()}`;
        let batchStatus = payoutBatch.batch_header?.batch_status || 'SUCCESS';

        if (batchStatus === 'PENDING') {
          try {
            const poll = await getPayoutBatch(batchId);
            batchStatus = poll.batch_header?.batch_status || batchStatus;
          } catch {
            // Keep pending/success
          }
        }

        if (batchStatus === 'FAILED' || batchStatus === 'DENIED' || batchStatus === 'CANCELED') {
          throw new Error(`PayPal payout batch status: ${batchStatus}`);
        }

        updateTransactionStatus(db, tx.id, 'completed', batchId);
        writeAudit(db, {
          user_id: tx.user_id,
          kind: 'payment_completed',
          payload: JSON.stringify({ transactionId: tx.id, batchId, amount: tx.amount }),
        });

        const newBalance = getBalance(db, tx.user_id);
        res.status(200).json({
          status: 'completed',
          transactionId: tx.id,
          batchId,
          newBalance,
          spoken_message: `Payment of ₹${tx.amount} completed successfully.`,
        });
      } catch (payoutErr) {
        addLedgerEntry(db, {
          user_id: tx.user_id,
          delta: tx.amount,
          reason: `Reversal for failed tx ${tx.id}`,
          ref: `rev_${tx.id}`,
        });

        updateTransactionStatus(db, tx.id, 'failed');
        writeAudit(db, {
          user_id: tx.user_id,
          kind: 'payment_failed_reversed',
          payload: JSON.stringify({
            transactionId: tx.id,
            error: (payoutErr as Error).message,
          }),
        });

        res.status(500).json({
          status: 'failed',
          error: (payoutErr as Error).message,
          spoken_message: 'Payment failed and amount was refunded to your wallet.',
        });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const tx = getTransactionById(db, req.params.id);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      res.status(200).json({ transaction: tx });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
