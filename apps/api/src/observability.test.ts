import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { apiLoggerOptions, registerObservability } from './observability.js';
import { buildServer } from './server.js';

describe('logs da API', () => {
  it('são JSON com service=api e IP do cliente mascarado', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) };
    const options = apiLoggerOptions({ LOG_LEVEL: 'info' });
    const app = Fastify({ logger: { ...(options as object), stream } });
    app.get('/x', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/x', remoteAddress: '203.0.113.77' });
    const incoming = lines.find((l) => l.msg === 'incoming request');
    expect(incoming).toMatchObject({
      service: 'api',
      level: 'info',
      req: { client_ip: '203.0.113.0', route: '/x' },
    });
    expect(JSON.stringify(lines)).not.toContain('203.0.113.77');
  });

  it('não registra os healthchecks como log de acesso', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) };
    const app = Fastify({ logger: { ...(apiLoggerOptions({}) as object), stream } });
    registerObservability(app);
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/x', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/x' });
    const urls = lines.filter((l) => l.msg === 'incoming request').map((l) => (l.req as { url: string }).url);
    expect(urls).toEqual(['/x']);
  });
});

describe('/metrics', () => {
  it('expõe a latência das rotas pelo template, sem banco', async () => {
    const app = buildServer();
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/nao-existe' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toMatch(
      /galaxie_http_request_duration_seconds_count\{method="GET",route="\/health",status_code="200"\} 1/,
    );
    expect(res.body).toMatch(/route="unmatched",status_code="404"/);
    expect(res.body).toContain('galaxie_live_poll_interval_seconds');
  });

  it('exige o token quando METRICS_TOKEN está definido', async () => {
    const app = Fastify();
    registerObservability(app, { env: { METRICS_TOKEN: 's3cr3t' } });
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer s3cr3t' },
    });
    expect(ok.statusCode).toBe(200);
  });
});
