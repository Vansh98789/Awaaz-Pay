import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import crypto from 'node:crypto';
import { processConversation } from '../conversation/orchestrator.js';
import { requireAuth } from '../auth/middleware.js';

export function createConverseRouter(db: Database): Router {
  const router = Router();

  router.post('/converse', requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || req.body?.userId || 'user_meena';
      const { text, sessionId = crypto.randomUUID(), lang } = req.body;

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text input is required' });
        return;
      }

      const response = await processConversation(db, sessionId, text, userId, lang);
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
