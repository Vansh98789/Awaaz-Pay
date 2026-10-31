import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import {
  getPendingNotifications,
  markNotificationDelivered,
  markNotificationsDelivered,
} from '../db/repository.js';

export function createNotificationsRouter(db: Database): Router {
  const router = Router();

  router.get('/pending', async (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'user_meena';
      const notifications = await getPendingNotifications(db, userId);
      res.status(200).json({ notifications });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/delivered', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      await markNotificationDelivered(db, id);
      res.status(200).json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/mark-delivered', async (req: Request, res: Response) => {
    try {
      const { id, ids } = req.body;
      if (id) {
        await markNotificationDelivered(db, id);
      } else if (Array.isArray(ids)) {
        await markNotificationsDelivered(db, ids);
      }
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
