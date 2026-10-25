import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKey, closeDb, createDb, runMigrations, tenant, usageDaily, type Database } from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { buildServer } from '../src/server.js';
import { RedisUsageBackend, utcDay } from '../src/usage/counter.js';

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
const ADMIN_KEY = generateAdminKey();
const plans = loadPlans();

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let usage: RedisUsageBackend;

const adminReq = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  remoteAddress = '10.1.2.3',
) =>
  app.inject({
    method,
    url,
    remoteAddress,
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const tenantReq = (key: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { 'x-galaxie-key': key },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const waitFlush = () => new Promise((r) => setTimeout(r, 120));

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  usage = new RedisUsageBackend(redis, keyPrefix);
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usage,
    usageFlushIntervalMs: 20,
    // sem cache de autenticação: revogação/suspensão valem na hora (em produção, até 60 s)
    authenticator: { cacheTtlMs: 0 },
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8', '::1'], plans },
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

describe('acesso às rotas administrativas', () => {
  it('fora da allowlist a rota "não existe" (404); sem chave → 401; com chave → 200 no-store', async () => {
    const outside = await adminReq('GET', '/internal/admin/plans', undefined, '203.0.113.9');
    expect(outside.statusCode).toBe(404);
    const noKey = await app.inject({
      method: 'GET',
      url: '/internal/admin/plans',
      remoteAddress: '10.0.0.5',
    });
    expect(noKey.statusCode).toBe(401);
    const ok = await adminReq('GET', '/internal/admin/plans');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.headers['x-robots-tag']).toContain('noindex');
    expect(ok.json().data.fan_experience.modules).toEqual(['core_data', 'where_to_watch', 'semantic']);
  });

  it('chave de tenant não abre rotas administrativas', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/admin/plans',
      remoteAddress: '10.0.0.5',
      headers: { 'x-galaxie-admin-key': 'gs_live_000000000000_' + 'A'.repeat(43) },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('onboarding de tenant', () => {
  let tenantId: string;
  let firstKey: string;

  it('cria o tenant a partir do modelo do plano e exibe a chave uma única vez', async () => {
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'portal-esportivo',
      name: 'Portal Esportivo',
      plan: 'fan_experience',
      markets: ['br', 'ar'],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant).toMatchObject({
      slug: 'portal-esportivo',
      plan: 'fan_experience',
      modules: ['core_data', 'where_to_watch', 'semantic'],
      markets: ['BR', 'AR'],
      rateLimitPerMinute: plans.fan_experience.rateLimitPerMinute,
      dailyRequestQuota: plans.fan_experience.dailyRequestQuota,
      status: 'active',
    });
    expect(body.key.key).toMatch(/^gs_live_[0-9a-f]{12}_/);
    expect(body.key.notice).toMatch(/não será exibida novamente/);
    tenantId = body.tenant.id;
    firstKey = body.key.key;

    const [row] = await db.select().from(apiKey).where(eq(apiKey.tenantId, tenantId));
    expect(row!.secretHash).toMatch(/^scrypt\$/);
    expect(row!.env).toBe('live');
    const detail = await adminReq('GET', `/internal/admin/tenants/portal-esportivo`);
    expect(JSON.stringify(detail.json())).not.toContain(row!.secretHash);
    expect(detail.json().keys).toHaveLength(1);

    const sports = await tenantReq(firstKey, 'GET', '/v1/sports');
    expect(sports.statusCode).toBe(200);
  });

  it('slug repetido → 409 CONFLICT; corpo inválido → 400 com os campos', async () => {
    const dup = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'portal-esportivo',
      name: 'X',
      plan: 'core_data',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: 'CONFLICT' });
    const bad = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'Com Espaço',
      name: '',
      plan: 'platinum',
      extra: true,
    });
    expect(bad.statusCode).toBe(400);
    const paths = bad.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['slug', 'name', 'plan']));
  });

  it('emite chave com escopo dentro dos módulos; escopo fora → 400', async () => {
    const bad = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, {
      scopes: ['live_intelligence'],
    });
    expect(bad.statusCode).toBe(400);
    const ok = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, {
      label: 'só catálogo',
      scopes: ['core_data'],
      env: 'test',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().key.key).toMatch(/^gs_test_/);
    const me = await tenantReq(ok.json().key.key, 'GET', '/v1/account');
    expect(me.json().key).toMatchObject({
      label: 'só catálogo',
      env: 'test',
      effectiveModules: ['core_data'],
    });
  });

  it('rotação administrativa com graceSeconds 0 invalida a chave antiga na hora', async () => {
    const issued = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, {
      label: 'rotacionar',
    });
    const old = issued.json().key;
    const rotated = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${old.id}/rotate`, {
      graceSeconds: 0,
    });
    expect(rotated.statusCode).toBe(201);
    expect(rotated.json().previous).toMatchObject({ id: old.id, status: 'revoked' });
    expect((await tenantReq(old.key, 'GET', '/v1/sports')).statusCode).toBe(401);
    expect((await tenantReq(rotated.json().key.key, 'GET', '/v1/sports')).statusCode).toBe(200);
    const again = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${old.id}/rotate`, {});
    expect(again.statusCode).toBe(404);
  });

  it('revogação e suspensão do tenant bloqueiam o acesso', async () => {
    const issued = (await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, {})).json().key;
    const revoked = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${issued.id}/revoke`);
    expect(revoked.json()).toEqual({ revoked: true, keyId: issued.id });
    expect((await tenantReq(issued.key, 'GET', '/v1/sports')).statusCode).toBe(401);
    expect(
      (await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${issued.id}/revoke`)).statusCode,
    ).toBe(404);

    const suspended = await adminReq('PATCH', `/internal/admin/tenants/${tenantId}`, { status: 'suspended' });
    expect(suspended.json().tenant.status).toBe('suspended');
    expect((await tenantReq(firstKey, 'GET', '/v1/sports')).statusCode).toBe(401);
    await adminReq('PATCH', `/internal/admin/tenants/${tenantId}`, { status: 'active' });
    expect((await tenantReq(firstKey, 'GET', '/v1/sports')).statusCode).toBe(200);
  });

  it('PATCH com troca de plano e applyTemplate reaplica o modelo; ajustes explícitos prevalecem', async () => {
    const res = await adminReq('PATCH', `/internal/admin/tenants/${tenantId}`, {
      plan: 'live_intelligence',
      applyTemplate: true,
      rateLimitPerMinute: 999,
    });
    expect(res.json().tenant).toMatchObject({
      plan: 'live_intelligence',
      modules: plans.live_intelligence.modules,
      markets: [],
      rateLimitPerMinute: 999,
    });
    expect((await adminReq('PATCH', `/internal/admin/tenants/${tenantId}`, {})).statusCode).toBe(400);
    expect((await adminReq('PATCH', `/internal/admin/tenants/nao-existe`, { name: 'x' })).statusCode).toBe(
      404,
    );
  });

  it('lista tenants com filtro por plano', async () => {
    await adminReq('POST', '/internal/admin/tenants', {
      slug: 'radio-am',
      name: 'Rádio',
      plan: 'core_data',
      key: false,
    });
    const all = await adminReq('GET', '/internal/admin/tenants');
    expect(all.json().data.map((t: { slug: string }) => t.slug)).toEqual(['portal-esportivo', 'radio-am']);
    const core = await adminReq('GET', '/internal/admin/tenants?plan=core_data');
    expect(core.json().data).toHaveLength(1);
    expect((await adminReq('GET', '/internal/admin/tenants?limit=0')).statusCode).toBe(400);
  });
});

describe('autoatendimento /v1/account', () => {
  let key: string;
  let tenantId: string;

  beforeAll(async () => {
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'ott-latam',
      name: 'OTT',
      plan: 'core_data',
      key: { label: 'produção' },
    });
    key = res.json().key.key;
    tenantId = res.json().tenant.id;
  });

  it('GET /v1/account mostra plano, limites e a chave em uso (sem segredos)', async () => {
    const res = await tenantReq(key, 'GET', '/v1/account');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({
      tenant: { slug: 'ott-latam', plan: 'core_data', modules: ['core_data'] },
      key: { label: 'produção', env: 'live', status: 'active', effectiveModules: ['core_data'] },
    });
    expect(res.body).not.toContain('scrypt');
    expect((await app.inject({ method: 'GET', url: '/v1/account' })).statusCode).toBe(401);
  });

  it('rotação pelo próprio tenant mantém a chave antiga durante o período de graça', async () => {
    const res = await tenantReq(key, 'POST', '/v1/account/keys/rotate', { graceSeconds: 3600 });
    expect(res.statusCode).toBe(201);
    const fresh = res.json().key.key as string;
    expect(fresh).not.toBe(key);
    expect(res.json().previous.status).toBe('expiring');
    expect((await tenantReq(key, 'GET', '/v1/sports')).statusCode).toBe(200);
    expect((await tenantReq(fresh, 'GET', '/v1/sports')).statusCode).toBe(200);

    const keys = (await tenantReq(fresh, 'GET', '/v1/account/keys')).json().data;
    expect(keys).toHaveLength(2);
    expect(keys.map((k: { label: string }) => k.label)).toEqual(['produção', 'produção']);
    expect((await tenantReq(fresh, 'POST', '/v1/account/keys/rotate', { graceSeconds: -1 })).statusCode).toBe(
      400,
    );
    key = fresh;
  });

  it('conta o uso no Valkey, consolida no Postgres e mostra por dia e rota', async () => {
    for (let i = 0; i < 3; i++) await tenantReq(key, 'GET', '/v1/sports');
    await tenantReq(key, 'GET', '/v1/countries');
    await waitFlush();

    const live = await tenantReq(key, 'GET', '/v1/account/usage');
    expect(live.statusCode).toBe(200);
    const today = live.json().days.find((d: { day: string }) => d.day === utcDay());
    const sportsCount = today.routes.find((r: { route: string }) => r.route === 'GET /v1/sports').requests;
    expect(sportsCount).toBeGreaterThanOrEqual(3);
    expect(today.routes.find((r: { route: string }) => r.route === 'GET /v1/countries').requests).toBe(1);
    expect(live.json().dailyRequestQuota).toBe(plans.core_data.dailyRequestQuota);

    const flushed = await adminReq('POST', '/internal/admin/usage/flush');
    expect(flushed.json().rows).toBeGreaterThan(0);
    const rows = await db.select().from(usageDaily).where(eq(usageDaily.tenantId, tenantId));
    expect(rows.find((r) => r.route === 'GET /v1/sports')!.requests).toBe(sportsCount);

    // flush idempotente e resistente a um Valkey zerado: o consolidado não diminui
    await redis.del(`${keyPrefix}usage:${utcDay()}:${tenantId}`);
    await adminReq('POST', '/internal/admin/usage/flush');
    const fromDb = await adminReq('GET', `/internal/admin/tenants/ott-latam/usage`);
    const day = fromDb.json().days.find((d: { day: string }) => d.day === utcDay());
    expect(day.routes.find((r: { route: string }) => r.route === 'GET /v1/sports').requests).toBe(
      sportsCount,
    );
    expect(fromDb.json().total).toBeGreaterThanOrEqual(sportsCount + 1);

    const all = await adminReq('GET', '/internal/admin/usage');
    expect(all.json().tenants.find((t: { slug: string }) => t.slug === 'ott-latam').total).toBeGreaterThan(0);
    expect((await tenantReq(key, 'GET', '/v1/account/usage?from=2026-13-01')).statusCode).toBe(400);
  });

  it('a consolidação ignora tenants removidos', async () => {
    const [t] = await db
      .insert(tenant)
      .values({ slug: 'efemero', name: 'x', plan: 'core_data', modules: ['core_data'] })
      .returning();
    await usage.incr([{ day: utcDay(), tenantId: t!.id, route: 'GET /v1/sports', n: 2 }]);
    await db.delete(tenant).where(eq(tenant.id, t!.id));
    expect((await adminReq('POST', '/internal/admin/usage/flush')).statusCode).toBe(200);
  });
});

describe('rotação não gera chave eterna (auditoria API-1)', () => {
  let tenantId: string;
  let trialKey: string;
  let trialExpiresAt: string;

  beforeAll(async () => {
    trialExpiresAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'trial-rotacao',
      name: 'Trial',
      plan: 'core_data',
      key: { label: 'trial', expiresAt: trialExpiresAt },
    });
    expect(res.statusCode).toBe(201);
    tenantId = res.json().tenant.id;
    trialKey = res.json().key.key;
  });

  it('a chave nova herda a validade da antiga (trial continua com prazo)', async () => {
    const res = await tenantReq(trialKey, 'POST', '/v1/account/keys/rotate', { graceSeconds: 3600 });
    expect(res.statusCode).toBe(201);
    const fresh = res.json().key.key as string;
    const me = await tenantReq(fresh, 'GET', '/v1/account');
    expect(me.json().key).toMatchObject({ status: 'expiring', label: 'trial' });
    expect(new Date(me.json().key.expiresAt).getTime()).toBe(new Date(trialExpiresAt).getTime());
    // a antiga vale só no período de graça (antes do fim do trial)
    expect(new Date(res.json().previous.expiresAt).getTime()).toBeLessThan(
      new Date(trialExpiresAt).getTime(),
    );
  });

  it('a chave antiga, já em graça, não rotaciona de novo (pelo tenant nem pela operação)', async () => {
    expect((await tenantReq(trialKey, 'GET', '/v1/sports')).statusCode).toBe(200);
    const self = await tenantReq(trialKey, 'POST', '/v1/account/keys/rotate', { graceSeconds: 3600 });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe('CONFLICT');
    const keys = (await adminReq('GET', `/internal/admin/tenants/${tenantId}`)).json().keys as {
      id: string;
      prefix: string;
    }[];
    expect(keys).toHaveLength(2);
    const oldId = keys.find((k) => trialKey.includes(`_${k.prefix}_`))!.id;
    const admin = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${oldId}/rotate`, {});
    expect(admin.statusCode).toBe(409);
  });

  it('teto de chaves válidas por tenant: rotação recusada até revogar uma', async () => {
    const issued: { id: string; key: string }[] = [];
    // 2 válidas da etapa anterior + 18 = 20 (o teto)
    for (let i = 0; i < 18; i++)
      issued.push((await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, {})).json().key);
    const blocked = await tenantReq(issued[0]!.key, 'POST', '/v1/account/keys/rotate', { graceSeconds: 0 });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().detail).toMatch(/20 chaves/);
    await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${issued[1]!.id}/revoke`);
    const ok = await tenantReq(issued[0]!.key, 'POST', '/v1/account/keys/rotate', { graceSeconds: 0 });
    expect(ok.statusCode).toBe(201);
  });
});
