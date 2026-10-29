import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('Server Endpoints', () => {
  it('GET /api/health returns status ok and valid current time', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.time).toBe('string');

    const parsedDate = new Date(response.body.time);
    expect(Number.isNaN(parsedDate.getTime())).toBe(false);
  });

  it('GET /api/unknown-route returns 404', async () => {
    const response = await request(app).get('/api/unknown-route');
    expect(response.status).toBe(404);
  });
});
