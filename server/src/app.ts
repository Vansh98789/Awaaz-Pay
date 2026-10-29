import cors from 'cors';
import cookieParser from 'cookie-parser';
import express, { type Express, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { getDb } from './db/connection.js';
import { createFamilyRouter } from './routes/family.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createPaymentsRouter } from './routes/payments.js';
import { createConverseRouter } from './routes/converse.js';
import { createAuthRouter } from './routes/auth.js';
import { requireAuth } from './auth/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../../web/dist');

export interface HealthResponse {
  status: 'ok';
  time: string;
}

export function createApp(db?: Database.Database): Express {
  const app = express();
  const database = db ?? getDb();

  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response<HealthResponse>) => {
    res.status(200).json({
      status: 'ok',
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', createAuthRouter(database));
  app.use('/api/family', createFamilyRouter(database));
  app.use('/api/webhooks', createWebhooksRouter(database));
  app.use('/api/notifications', createNotificationsRouter(database));
  app.use('/api/payments', requireAuth, createPaymentsRouter(database));
  app.use('/api', createConverseRouter(database));

  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));

    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'Endpoint not found' });
        return;
      }
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  return app;
}

export const app = createApp();
