import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../../web/dist');

export interface HealthResponse {
  status: 'ok';
  time: string;
}

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response<HealthResponse>) => {
    res.status(200).json({
      status: 'ok',
      time: new Date().toISOString(),
    });
  });

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
