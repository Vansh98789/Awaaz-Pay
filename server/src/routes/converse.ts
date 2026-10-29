import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { processConversation } from '../conversation/orchestrator.js';

export function createConverseRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/converse', async (req: Request, res: Response) => {
    try {
      const { text, sessionId = crypto.randomUUID(), userId = 'user_meena' } = req.body;

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text input is required' });
        return;
      }

      const response = await processConversation(db, sessionId, text, userId);
      res.status(200).json({
        sessionId,
        ...response,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
