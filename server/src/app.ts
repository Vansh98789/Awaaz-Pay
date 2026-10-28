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

// Separate app definition from listener to facilitate testing with supertest
export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Probes use this endpoint to verify server availability and clock state
  app.get('/api/health', (_req: Request, res: Response<HealthResponse>) => {
    res.status(200).json({
      status: 'ok',
      time: new Date().toISOString(),
    });
  });

  // Serve the built frontend on the same origin when web/dist exists (production mode)
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));

    // Handle client-side routing fallback while preserving 404s for unknown API routes
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
