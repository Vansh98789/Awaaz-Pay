import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';

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

  return app;
}

export const app = createApp();
