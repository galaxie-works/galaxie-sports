import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  createPublishableKey,
  publishableKey,
  revokePublishableKey,
  runMigrations,
  saveWidget,
  sport,
  type Database,
  type WidgetConfig,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;
const ORIGIN = 'https://app.exemplo.test';
const PK_LIMIT = 5;

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let tenantId: string;
let pk: string;
let pkId: string;
let secret: string;

const config: WidgetConfig = {
  theme: {
    primary: '#0a84ff',
    background: '#ffffff',
    surface: '#f5f5f7',
    foreground: '#111111',
    mutedForeground: '#6b7280',
    border: '#e5e7eb',
    radius: 12,
    fontFamily: 'Inter, sans-serif',
    density: 'compact',
    mode: 'light',
  },
  locale: 'pt-BR',
  market: 'BR',
  defaults: { sport: 'football' },
};

const pkGet = (url: string, headers: Record<string, string> = {}, key = pk) =>
  app.inject({
    method: 'GET',
    url,
    headers: { 'x-galaxie-publishable-key': key, origin: ORIGIN, ...headers },
  });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol', en: 'Football' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete', en: 'Basketball' } },
  ]);
  // Operadora Exemplo: só core_data e futebol
  ({ id: tenantId } = await upsertTenant(db, {
    slug: 'operadora-exemplo',
    name: 'Operadora Exemplo',
    plan: 'core_data',
    modules: ['core_data'],
    sports: ['football'],
    rateLimitPerMinute: 1000,
  }));
  ({ key: secret } = await createApiKey(db, tenantId, { label: 'backend' }));
  ({ id: pkId, key: pk } = await createPublishableKey(db, {
    tenantId,
    name: 'App da Operadora Exemplo',
    allowedOrigins: [ORIGIN, 'https://*.exemplo.test'],
  }));
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usage: false,
    // sem cache: revogação vale na hora (em produção, até 60 s); last_used_at a cada requisição
    authenticator: { cacheTtlMs: 0 },
    publishableAuthenticator: { cacheTtlMs: 0, touchIntervalMs: 0 },
    publishableRateLimitPerMinute: PK_LIMIT,
  });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

describe('chave publicável', () => {
  it('chave válida e origem certa → 200, com CORS só para essa origem e last_used_at', async () => {
    const res = await pkGet('/v1/sports', {}, pk);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((s: { slug: string }) => s.slug)).toEqual(['basketball', 'football']);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers.vary).toContain('Origin');
    // resposta por tenant: a CDN separa as cópias também pela chave publicável
    expect(res.headers.vary).toContain('x-galaxie-publishable-key');
    expect(res.headers['x-ratelimit-limit']).toBe(String(PK_LIMIT));

    await expect
      .poll(async () => {
        const [row] = await db
          .select({ at: publishableKey.lastUsedAt })
          .from(publishableKey)
          .where(eq(publishableKey.id, pkId));
        return row?.at;
      })
      .toBeInstanceOf(Date);
  });

  it('curinga de subdomínio e Referer (sem Origin) também valem', async () => {
    const sub = await pkGet('/v1/sports', { origin: 'https://loja.exemplo.test' });
    expect(sub.statusCode).toBe(200);
    expect(sub.headers['access-control-allow-origin']).toBe('https://loja.exemplo.test');

    const ref = await app.inject({
      method: 'GET',
      url: '/v1/sports',
      headers: { 'x-galaxie-publishable-key': pk, referer: `${ORIGIN}/jogos/hoje?x=1` },
    });
    expect(ref.statusCode).toBe(200);
    expect(ref.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('origem errada ou ausente → 403 problem+json, sem CORS', async () => {
    for (const headers of [
      { origin: 'https://atacante.test' },
      { origin: 'https://exemplo.test' },
      { origin: 'http://app.exemplo.test' },
      { origin: 'null' },
    ]) {
      const res = await pkGet('/v1/sports', headers);
      expect(res.statusCode, headers.origin).toBe(403);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED', status: 403 });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    const none = await app.inject({
      method: 'GET',
      url: '/v1/sports',
      headers: { 'x-galaxie-publishable-key': pk },
    });
    expect(none.statusCode).toBe(403);
    expect(none.json().code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('módulo ou esporte fora do contrato → 403', async () => {
    const glossary = await pkGet('/v1/glossary');
    expect(glossary.statusCode).toBe(403);
    expect(glossary.json().code).toBe('MODULE_NOT_IN_PLAN');

    const wtw = await pkGet('/v1/broadcasters');
    expect(wtw.statusCode).toBe(403);
    expect(wtw.json().code).toBe('MODULE_NOT_IN_PLAN');

    const basketball = await pkGet('/v1/events?sport=basketball');
    expect(basketball.statusCode).toBe(403);
    expect(basketball.json().code).toBe('MODULE_NOT_IN_PLAN');
  });

  it('POST, conta, SSE e espelho são recusados com 403', async () => {
    const rotate = await app.inject({
      method: 'POST',
      url: '/v1/account/keys/rotate',
      headers: { 'x-galaxie-publishable-key': pk, origin: ORIGIN },
      payload: {},
    });
    expect(rotate.statusCode).toBe(403);
    expect(rotate.json().code).toBe('PUBLISHABLE_KEY_NOT_ALLOWED');

    for (const url of ['/v1/account', '/v1/account/keys', '/mirror/football/status']) {
      const res = await pkGet(url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code, url).toBe('PUBLISHABLE_KEY_NOT_ALLOWED');
    }
  });

  it('a chave secreta continua igual (e tem precedência quando vem junto)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/account', headers: { 'x-galaxie-key': secret } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenant.slug).toBe('operadora-exemplo');
    const both = await app.inject({
      method: 'GET',
      url: '/v1/account',
      headers: { 'x-galaxie-key': secret, 'x-galaxie-publishable-key': pk },
    });
    expect(both.statusCode).toBe(200);
    // a publicável nunca vale no lugar da secreta
    const swapped = await app.inject({ method: 'GET', url: '/v1/sports', headers: { 'x-galaxie-key': pk } });
    expect(swapped.statusCode).toBe(401);
  });

  it('preflight CORS só responde para origens de chaves ativas', async () => {
    const preflight = (origin: string, method = 'GET') =>
      app.inject({
        method: 'OPTIONS',
        url: '/v1/sports',
        headers: {
          origin,
          'access-control-request-method': method,
          'access-control-request-headers': 'x-galaxie-publishable-key',
        },
      });
    const ok = await preflight('https://loja.exemplo.test');
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://loja.exemplo.test');
    expect(ok.headers['access-control-allow-headers']).toContain('x-galaxie-publishable-key');
    expect(ok.headers['access-control-allow-methods']).toBe('GET, HEAD');

    const evil = await preflight('https://atacante.test');
    expect(evil.statusCode).toBe(204);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();

    const post = await preflight(ORIGIN, 'POST');
    expect(post.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('chave presa a widget só alcança os módulos daquele tipo de widget', async () => {
    const w = await saveWidget(db, {
      tenantId,
      kind: 'standings',
      name: 'Tabela',
      config,
      createdBy: 'teste',
    });
    const bound = await createPublishableKey(db, {
      tenantId,
      name: 'Só a tabela',
      allowedOrigins: [ORIGIN],
      widgetId: w.id,
    });
    expect((await pkGet('/v1/sports', {}, bound.key)).statusCode).toBe(200);
  });

  it('rate limit próprio por chave × IP', async () => {
    const own = await createPublishableKey(db, { tenantId, name: 'limite', allowedOrigins: [ORIGIN] });
    const hit = (ip: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/sports',
        remoteAddress: ip,
        headers: { 'x-galaxie-publishable-key': own.key, origin: ORIGIN },
      });
    for (let i = 0; i < PK_LIMIT; i++) expect((await hit('10.9.0.1')).statusCode).toBe(200);
    const blocked = await hit('10.9.0.1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    // outro IP tem a própria janela
    expect((await hit('10.9.0.2')).statusCode).toBe(200);
  });

  it('publicável de teste (gs_pk_test_) só a partir de localhost', async () => {
    const dev = await createPublishableKey(db, {
      tenantId,
      name: 'dev',
      env: 'test',
      allowedOrigins: ['http://localhost:3000'],
    });
    const hit = (origin: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/sports',
        headers: { 'x-galaxie-publishable-key': dev.key, origin },
      });
    const ok = await hit('http://localhost:3000');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect((await hit(ORIGIN)).statusCode).toBe(403);
  });

  it('chave revogada ou inexistente → 401', async () => {
    const tmp = await createPublishableKey(db, { tenantId, name: 'temporária', allowedOrigins: [ORIGIN] });
    expect((await pkGet('/v1/sports', {}, tmp.key)).statusCode).toBe(200);
    await revokePublishableKey(db, tenantId, tmp.id);
    const revoked = await pkGet('/v1/sports', {}, tmp.key);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().code).toBe('INVALID_KEY');

    const unknown = await pkGet('/v1/sports', {}, `gs_pk_live_${'A'.repeat(43)}`);
    expect(unknown.statusCode).toBe(401);
    const malformed = await pkGet('/v1/sports', {}, 'gs_pk_live_curta');
    expect(malformed.statusCode).toBe(401);
  });
});
