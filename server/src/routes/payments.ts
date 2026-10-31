import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import { preparePayment, confirmPayment, refreshPayoutStatus } from '../payments/pipeline.js';
import { getApprovalByTransactionId, getTransactionById } from '../db/repository.js';

export function createPaymentsRouter(db: Database): Router {
  const router = Router();

  router.post('/prepare', async (req: Request, res: Response) => {
    try {
      const result = await preparePayment(db, req.body);
      res.status(200).json(result);
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('not found') ? 404 : 400;
      res.status(status).json({ error: msg });
    }
  });

  router.post('/confirm', async (req: Request, res: Response) => {
    try {
      const result = await confirmPayment(db, req.body);
      res.status(result.httpStatus || 200).json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const payoutSync = await refreshPayoutStatus(db, id);
      const tx = await getTransactionById(db, id);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      const approval = await getApprovalByTransactionId(db, id);
      res.status(200).json({
        transaction: tx,
        paypalStatus: payoutSync.paypalStatus,
        approvalStatus: approval?.status || 'none',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
