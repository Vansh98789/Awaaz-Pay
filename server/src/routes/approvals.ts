import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import {
  getApprovalByToken,
  getApprovalByTransactionId,
  updateApprovalStatus,
  getTransactionById,
  getUserById,
  updateTransactionStatus,
  writeAudit,
  createNotification,
} from '../db/repository.js';
import { confirmPayment } from '../payments/pipeline.js';
import { requireFamilyAuth } from '../auth/familyAuth.js';

export function createApprovalsRouter(db: Database): Router {
  const router = Router();
  router.use(requireFamilyAuth);

  // 1. Get approval details by token
  router.get('/:token', async (req: Request, res: Response) => {
    try {
      const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }
      const approval = await getApprovalByToken(db, token);

      if (!approval) {
        res.status(404).json({ error: 'Approval request not found' });
        return;
      }

      const tx = await getTransactionById(db, approval.transaction_id);
      if (!tx) {
        res.status(404).json({ error: 'Associated transaction not found' });
        return;
      }
      const user = await getUserById(db, tx.user_id);
      const isExpired =
        !!approval.expires_at && new Date() > new Date(approval.expires_at);

      // Find payee display name
      let payeeName = tx.counterparty_id;
      if (tx.counterparty_type === 'contact') {
        const c = (await db.query<{ display_name: string }>('SELECT display_name FROM contacts WHERE id = $1', [tx.counterparty_id]))[0];
        if (c) payeeName = c.display_name;
      } else if (tx.counterparty_type === 'merchant') {
        const m = (await db.query<{ name: string }>('SELECT name FROM merchants WHERE id = $1', [tx.counterparty_id]))[0];
        if (m) payeeName = m.name;
      }

      res.status(200).json({
        approvalId: approval.id,
        token: approval.token,
        status: approval.status,
        transactionId: tx.id,
        amount: tx.amount,
        currency: tx.currency,
        transactionStatus: tx.status,
        paypalBatchId: tx.paypal_ref,
        payee: payeeName,
        userName: user?.name || 'Meena',
        createdAt: approval.created_at,
        expiresAt: approval.expires_at,
        decidedAt: approval.decided_at,
        isExpired,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Decide approval (Approve or Deny)
  router.post('/:token/decide', async (req: Request, res: Response) => {
    try {
      const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }
      const { decision, note } = req.body;

      if (!decision || !['approve', 'deny'].includes(decision)) {
        res.status(400).json({ error: "Valid decision ('approve' or 'deny') is required" });
        return;
      }

      const approval = await getApprovalByToken(db, token);
      if (!approval) {
        res.status(404).json({ error: 'Approval request not found' });
        return;
      }

      if (approval.status !== 'pending') {
        res.status(400).json({
          error: `Approval request has already been decided: ${approval.status}`,
          status: approval.status,
        });
        return;
      }

      const tx = await getTransactionById(db, approval.transaction_id);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      if (approval.expires_at && new Date() > new Date(approval.expires_at)) {
        await updateApprovalStatus(db, token, 'expired');
        await updateTransactionStatus(db, tx.id, 'failed');
        res.status(400).json({ error: 'Approval request expired. No PayPal payout was sent.' });
        return;
      }
      if (tx.status !== 'awaiting_approval') {
        res.status(409).json({ error: 'This payment is not waiting for guardian approval.' });
        return;
      }

      const guardian = (await db.query<{ name: string }>('SELECT name FROM guardians WHERE id = $1', [approval.guardian_id]))[0];
      const guardianName = guardian?.name || 'Ramesh';

      let payeeName = tx.counterparty_id;
      if (tx.counterparty_type === 'contact') {
        const c = (await db.query<{ display_name: string }>('SELECT display_name FROM contacts WHERE id = $1', [tx.counterparty_id]))[0];
        if (c) payeeName = c.display_name;
      }

      if (decision === 'approve') {
        await updateApprovalStatus(db, token, 'approved');
        await updateTransactionStatus(db, tx.id, 'confirmed');

        await writeAudit(db, {
          user_id: tx.user_id,
          kind: 'guardian_approval_approved',
          payload: JSON.stringify({
            approvalId: approval.id,
            token,
            transactionId: tx.id,
            amount: tx.amount,
            note,
          }),
        });

        await createNotification(db, {
          user_id: tx.user_id,
          kind: 'approval_granted',
          message: `${guardianName} approved payment of $${tx.amount.toFixed(2)} to ${payeeName}.`,
          spoken_text: `${guardianName} ji ne ${payeeName} ko ${tx.amount.toFixed(2)} US dollars bhejne ki manzoori de di hai. PayPal Sandbox payment bheji ja rahi hai.`,
        });

        // Guardian approval is the final gate. Dispatch the exact transaction the user already confirmed.
        const payment = await confirmPayment(db, { transactionId: tx.id, userConfirmed: true });

        res.status(200).json({
          success: true,
          status: 'approved',
          transactionId: tx.id,
          paymentStatus: payment.status,
          paypalStatus: payment.paypalStatus,
          batchId: payment.batchId,
          message: payment.status === 'completed'
            ? 'PayPal Sandbox confirmed the payment.'
            : payment.status === 'processing'
              ? 'PayPal Sandbox is processing the approved payment.'
              : payment.message || payment.error || 'The payment could not be sent.',
        });
      } else {
        await updateApprovalStatus(db, token, 'denied');
        await updateTransactionStatus(db, tx.id, 'failed');

        await writeAudit(db, {
          user_id: tx.user_id,
          kind: 'guardian_approval_denied',
          payload: JSON.stringify({
            approvalId: approval.id,
            token,
            transactionId: tx.id,
            amount: tx.amount,
            note,
          }),
        });

        await createNotification(db, {
          user_id: tx.user_id,
          kind: 'approval_denied',
          message: `${guardianName} denied payment of $${tx.amount.toFixed(2)} to ${payeeName}.`,
          spoken_text: `${guardianName} ji ne yeh payment reject kar diya hai. PayPal payout nahi bheja gaya.`,
        });

        res.status(200).json({
          success: true,
          status: 'denied',
          transactionId: tx.id,
        });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Poll approval status by transactionId
  router.get('/status/:transactionId', async (req: Request, res: Response) => {
    try {
      const transactionId = Array.isArray(req.params.transactionId)
        ? req.params.transactionId[0]
        : req.params.transactionId;
      if (!transactionId) {
        res.status(400).json({ error: 'Transaction ID is required' });
        return;
      }
      const approval = await getApprovalByTransactionId(db, transactionId);
      const tx = await getTransactionById(db, transactionId);

      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      res.status(200).json({
        transactionId,
        approvalStatus: approval?.status || 'none',
        transactionStatus: tx.status,
        approvalToken: approval?.token,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
