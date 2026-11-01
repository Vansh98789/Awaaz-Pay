import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import { preparePayment, confirmPayment, reconcilePayoutStatus, refreshPayoutStatus } from '../payments/pipeline.js';
import { getApprovalByTransactionId, getTransactionById } from '../db/repository.js';

export function createPaymentsRouter(db: Database): Router {
  const router = Router();

  router.post('/prepare', async (req: Request, res: Response) => {
    try {
      const result = await preparePayment(db, { ...req.body, userId: req.user?.id });
      res.status(200).json(result);
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      res.status(status).json({ error: msg });
    }
  });

  router.post('/confirm', async (req: Request, res: Response) => {
    try {
      const transactionId = typeof req.body.transactionId === 'string' ? req.body.transactionId : '';
      const tx = await getTransactionById(db, transactionId);
      if (!tx || tx.user_id !== req.user?.id) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      const result = await confirmPayment(db, req.body);
      res.status(result.httpStatus || 200).json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/reconcile', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const tx = await getTransactionById(db, id);
      if (!tx || tx.user_id !== req.user?.id) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      const result = await reconcilePayoutStatus(db, id);
      res.status(result.httpStatus || 200).json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const tx = await getTransactionById(db, id);
      if (!tx || tx.user_id !== req.user?.id) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      const payoutSync = await refreshPayoutStatus(db, id);
      const updatedTx = await getTransactionById(db, id);
      const approval = await getApprovalByTransactionId(db, id);
      res.status(200).json({
        transaction: updatedTx || tx,
        paypalStatus: payoutSync.paypalStatus,
        approvalStatus: approval?.status || 'none',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
