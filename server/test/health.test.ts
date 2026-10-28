import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns status ok and valid current time', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.time).toBe('string');

    // Ensure the returned time string is a valid ISO timestamp
    const parsedDate = new Date(response.body.time);
    expect(Number.isNaN(parsedDate.getTime())).toBe(false);
  });
});
