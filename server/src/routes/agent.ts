import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { understandAppRequest } from '../agent/decision.js';

const requestSchema = z.object({
  text: z.string().trim().min(1).max(800),
  screen: z.enum(['wallet', 'settings', 'activity', 'family', 'merchant', 'scanner']).default('wallet'),
  language: z.enum(['hi-IN', 'en-IN']).default('en-IN'),
  preferences: z.record(z.unknown()).default({}),
  conversationState: z.string().max(60).default('idle'),
  transactionContext: z.array(z.object({
    amount: z.number().finite().nonnegative(),
    counterparty: z.string().max(120),
    time: z.string().max(40),
    direction: z.enum(['IN', 'OUT']),
  })).max(500).default([]),
});

export function createAgentRouter(): Router {
  const router = Router();

  router.post('/understand', requireAuth, async (req: Request, res: Response) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A voice request and valid app context are required.' });
      return;
    }

    try {
      const decision = await understandAppRequest(parsed.data);
      res.status(200).json(decision);
    } catch (err) {
      res.status(503).json({
        error: (err as Error).message || 'The voice assistant is unavailable right now.',
        code: 'APP_AGENT_UNAVAILABLE',
      });
    }
  });

  return router;
}
