import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { memoryTenant } from './test-helpers.js';

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

describe('documentação', () => {
  it('publica o OpenAPI 3.1 e a referência interativa sem exigir chave', async () => {
    const app = buildServer({ publicUrl: 'http://api.test' });
    const spec = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json()).toMatchObject({ openapi: '3.1.0', servers: [{ url: 'http://api.test' }] });
    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');
    expect(docs.body).toContain('/openapi.json');
  });
});

describe('autenticação e planos', () => {
  it('sem banco nem tenant store responde 503 DEGRADED em problem+json', async () => {
    const res = await buildServer().inject({ method: 'GET', url: '/v1/sports' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 503, code: 'DEGRADED' });
  });

  it('chave ausente ou inválida → 401 INVALID_KEY', async () => {
    const { store, key } = await memoryTenant();
    const app = buildServer({ tenantStore: store });
    const missing = await app.inject({ method: 'GET', url: '/v1/sports' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({
      type: 'https://docs.galaxie.sports/errors/invalid-key',
      code: 'INVALID_KEY',
      status: 401,
      instance: '/v1/sports',
    });
    const malformed = await app.inject({
      method: 'GET',
      url: '/v1/sports',
      headers: { 'x-galaxie-key': 'xyz' },
    });
    expect(malformed.statusCode).toBe(401);
    const wrongSecret = key.slice(0, -4) + 'AAAA';
    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/sports',
      headers: { 'x-galaxie-key': wrongSecret },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('chave sem o módulo → 403 MODULE_NOT_IN_PLAN', async () => {
    const { store, key } = await memoryTenant({ plan: 'fan_experience', scopes: ['semantic'] });
    const app = buildServer({ tenantStore: store });
    const res = await app.inject({ method: 'GET', url: '/v1/sports', headers: { 'x-galaxie-key': key } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'MODULE_NOT_IN_PLAN',
      title: 'Plano não inclui o módulo core_data',
    });
  });

  it('tenant suspenso e chave revogada não autenticam', async () => {
    const suspended = await memoryTenant({ status: 'suspended' });
    const app = buildServer({ tenantStore: suspended.store });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sports',
      headers: { 'x-galaxie-key': suspended.key },
    });
    expect(res.statusCode).toBe(401);

    const revoked = await memoryTenant();
    revoked.store.keys.get(revoked.prefix)!.revokedAt = new Date(Date.now() - 1000);
    const res2 = await buildServer({ tenantStore: revoked.store }).inject({
      method: 'GET',
      url: '/v1/sports',
      headers: { 'x-galaxie-key': revoked.key },
    });
    expect(res2.json()).toMatchObject({ code: 'INVALID_KEY', detail: 'Chave revogada.' });
  });

  it('esporte fora do contrato no espelho → 403', async () => {
    const { store, key } = await memoryTenant({ sports: ['football'] });
    const app = buildServer({ tenantStore: store });
    const res = await app.inject({
      method: 'GET',
      url: '/mirror/basketball/games?date=2026-10-21',
      headers: { 'x-galaxie-key': key },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'MODULE_NOT_IN_PLAN' });
  });
});

describe('rate limit', () => {
  it('aplica o limite do tenant por rota, com headers x-ratelimit-*', async () => {
    const { store, key } = await memoryTenant({ rateLimitPerMinute: 2 });
    const app = buildServer({ tenantStore: store });
    const call = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

    // sem banco as rotas respondem 503, mas a contagem acontece antes
    const first = await call('/v1/sports');
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    expect(Number(first.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    await call('/v1/sports');
    const third = await call('/v1/sports');
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect(third.json()).toMatchObject({ code: 'RATE_LIMITED' });

    // outra rota tem janela própria
    const other = await call('/v1/countries');
    expect(other.headers['x-ratelimit-remaining']).toBe('1');
  });
});

describe('erros', () => {
  it('rota inexistente → 404 NOT_FOUND em problem+json', async () => {
    const res = await buildServer().inject({ method: 'GET', url: '/v1/nada' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('parâmetro inválido → 400 INVALID_PARAMS com a lista de campos', async () => {
    const { store, key } = await memoryTenant();
    const app = buildServer({ tenantStore: store });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/competitions?tier=9&locale=fr-FR',
      headers: { 'x-galaxie-key': key },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('INVALID_PARAMS');
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['locale', 'tier']);
  });

  it('endpoint inválido no espelho → 400; esporte desconhecido → 404', async () => {
    const { store, key } = await memoryTenant();
    const app = buildServer({ tenantStore: store });
    const headers = { 'x-galaxie-key': key };
    expect(
      (await app.inject({ method: 'GET', url: '/mirror/football/FIX%20TURES', headers })).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/mirror/cricket/fixtures', headers })).statusCode).toBe(
      404,
    );
  });
});
