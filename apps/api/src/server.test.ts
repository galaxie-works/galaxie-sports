import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('health', () => {
  it('responde ok sem banco', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('informa banco indisponível quando não configurado', async () => {
    const res = await buildServer().inject({ method: 'GET', url: '/health/db' });
    expect(res.statusCode).toBe(503);
  });
});
