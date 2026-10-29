import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { preparePayment, confirmPayment } from '../payments/pipeline.js';
import { getTransactionById } from '../db/repository.js';

export function createPaymentsRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/prepare', (req: Request, res: Response) => {
    try {
      const result = preparePayment(db, req.body);
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

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const tx = getTransactionById(db, id);
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
