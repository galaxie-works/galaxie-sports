import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiKey, closeDb, createDb, runMigrations, tenant, usageDaily, type Database } from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { applyKeyMigration, KeyMigrationError, planKeyMigration } from '../src/admin/key-migration.js';
import { KeyPolicyError, resolveTenantValues, upsertTenantWithKey } from '../src/admin/tenants.js';
import { formatApiKey, parseApiKey } from '../src/auth/keys.js';
import { buildServer } from '../src/server.js';
import { withRandomSecret } from '../src/test-helpers.js';
import { RedisUsageBackend, utcDay } from '../src/usage/counter.js';
import { QuotaGuard } from '../src/usage/quota.js';

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

/**
 * Os testes de uso leem e gravam o "dia de hoje" (UTC) em vários passos: perto da meia-noite, a contagem cai num dia
 * e a conferência no outro. Faltando menos de `marginMs`, espera a virada.
 */
async function awayFromUtcMidnight(marginMs = 30_000): Promise<void> {
  const left = 86_400_000 - (Date.now() % 86_400_000);
  if (left < marginMs) await new Promise((r) => setTimeout(r, left + 1_000));
}

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

  beforeEach(() => awayFromUtcMidnight(), 60_000);

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

  it('após Valkey zerado, o uso novo soma ao consolidado; dias retidos além de ontem são consolidados (C16/C17)', async () => {
    const countries = async (day = utcDay()) =>
      (await db.select().from(usageDaily).where(eq(usageDaily.tenantId, tenantId))).find(
        (r) => r.day === day && r.route === 'GET /v1/countries',
      )?.requests ?? 0;
    await adminReq('POST', '/internal/admin/usage/flush');
    const before = await countries();
    expect(before).toBeGreaterThan(0);
    // reinício do Valkey sem AOF: o hash do dia some e o contador recomeça do zero
    await redis.del(`${keyPrefix}usage:${utcDay()}:${tenantId}`);
    await tenantReq(key, 'GET', '/v1/countries');
    await tenantReq(key, 'GET', '/v1/countries');
    await waitFlush();
    await adminReq('POST', '/internal/admin/usage/flush');
    // greatest(consolidado, 2) congelaria em `before`; a época nova do hash soma
    expect(await countries()).toBe(before + 2);
    // a API de uso mostra o mesmo total antes e depois de consolidar
    const shown = async () =>
      (await tenantReq(key, 'GET', '/v1/account/usage'))
        .json()
        .days.find((d: { day: string }) => d.day === utcDay())
        .routes.find((r: { route: string }) => r.route === 'GET /v1/countries').requests;
    expect(await shown()).toBe(before + 2);
    await adminReq('POST', '/internal/admin/usage/flush');
    expect(await countries()).toBe(before + 2);
    // AOF everysec truncado: o hash volta a um estado anterior da mesma época (sem a última contagem).
    // A consolidação não escreve no Valkey, então nada dela se perde — e nada é somado de novo
    const hash = `${keyPrefix}usage:${utcDay()}:${tenantId}`;
    await redis.hset(hash, 'GET /v1/countries', '1');
    await adminReq('POST', '/internal/admin/usage/flush');
    expect(await countries()).toBe(before + 2);
    // e uma segunda perda logo depois (época nova de novo) soma só o contado nela
    await redis.del(hash);
    await tenantReq(key, 'GET', '/v1/countries');
    await waitFlush();
    await adminReq('POST', '/internal/admin/usage/flush');
    await adminReq('POST', '/internal/admin/usage/flush');
    expect(await countries()).toBe(before + 3);

    // rollout/rollback: uma versão sem épocas consolida junto, gravando só greatest(requests, contador)
    const route = 'GET /v1/rollback';
    const rollbackRow = async () =>
      (await db.select().from(usageDaily).where(eq(usageDaily.tenantId, tenantId))).find(
        (r) => r.day === utcDay() && r.route === route,
      )!;
    await usage.incr([{ day: utcDay(), tenantId, route, n: 10 }]);
    await adminReq('POST', '/internal/admin/usage/flush');
    expect((await rollbackRow()).requests).toBe(10);
    await usage.incr([{ day: utcDay(), tenantId, route, n: 140 }]);
    await db.execute(
      sql`update api.usage_daily set requests = greatest(requests, 150)
           where tenant_id = ${tenantId} and day = ${utcDay()} and route = ${route}`,
    );
    await usage.incr([{ day: utcDay(), tenantId, route, n: 10 }]);
    await adminReq('POST', '/internal/admin/usage/flush');
    expect((await rollbackRow()).requests).toBe(160); // não 300
    // snapshot de uma época mais velha que a gravada (corrida após Valkey zerado): ignorado
    await db.update(usageDaily).set({ epoch: '999999999999999-z' }).where(eq(usageDaily.route, route));
    await usage.incr([{ day: utcDay(), tenantId, route, n: 5 }]);
    await adminReq('POST', '/internal/admin/usage/flush');
    expect((await rollbackRow()).requests).toBe(160);

    // Postgres fora por mais de um dia: o dia de 3 dias atrás ainda está no Valkey e é consolidado
    const old = utcDay(new Date(Date.now() - 3 * 86_400_000));
    await usage.incr([{ day: old, tenantId, route: 'GET /v1/countries', n: 5 }]);
    await adminReq('POST', '/internal/admin/usage/flush');
    expect(await countries(old)).toBe(5);
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

describe('autenticação sob chaves aleatórias (auditoria API-2)', () => {
  let throttled: FastifyInstance;
  let key: string;
  const req = (k: string, ip: string) =>
    throttled.inject({
      method: 'GET',
      url: '/v1/sports',
      remoteAddress: ip,
      headers: { 'x-galaxie-key': k },
    });
  const withSecret = withRandomSecret;

  beforeAll(async () => {
    // limite baixo e compartilhado no Valkey (o padrão é 60 por IP e por prefixo)
    throttled = buildServer({
      db,
      redis,
      keyPrefix,
      usage: false,
      authenticator: { cacheTtlMs: 0 },
      authThrottle: { attemptsPerMinute: 3 },
    });
    await throttled.ready();
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'alvo-forca-bruta',
      name: 'Alvo',
      plan: 'core_data',
    });
    key = res.json().key.key;
  });
  afterAll(async () => throttled?.close());

  it('segredos aleatórios num prefixo real esbarram no limite antes do scrypt; a chave verificada segue', async () => {
    expect((await req(key, '192.0.2.10')).statusCode).toBe(200);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await req(withSecret(key), `192.0.2.${20 + i}`)).statusCode);
    expect(statuses).toEqual([401, 401, 429, 429, 429]);
    const blocked = await req(withSecret(key), '192.0.2.30');
    expect(blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // segredo já verificado nesta instância: não passa pelo limite nem pelo scrypt
    expect((await req(key, '192.0.2.10')).statusCode).toBe(200);

    // instância nova (deploy/restart/scale-out), com o prefixo ainda estourado: o Valkey lembra que esta
    // chave já acertou o segredo, então ela não cai no limite por prefixo
    const fresh = buildServer({
      db,
      redis,
      keyPrefix,
      usage: false,
      authenticator: { cacheTtlMs: 0 },
      authThrottle: { attemptsPerMinute: 3 },
    });
    try {
      const freshReq = (k: string, ip: string) =>
        fresh.inject({
          method: 'GET',
          url: '/v1/sports',
          remoteAddress: ip,
          headers: { 'x-galaxie-key': k },
        });
      expect((await freshReq(withSecret(key), '192.0.2.40')).statusCode).toBe(429);
      expect((await freshReq(key, '192.0.2.10')).statusCode).toBe(200);
    } finally {
      await fresh.close();
    }
  });

  it('prefixos aleatórios do mesmo IP esbarram no limite por IP antes do banco', async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++)
      statuses.push(
        (await req(`gs_live_${randomBytes(6).toString('hex')}_${'A'.repeat(43)}`, '192.0.2.99')).statusCode,
      );
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
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

  it('teto de 5 chaves válidas por ambiente (contando as em graça) na emissão e na rotação', async () => {
    const issued: { id: string; key: string }[] = [];
    // 2 live válidas da etapa anterior (uma em graça) + 3 = 5 (o teto)
    for (let i = 0; i < 3; i++) {
      const res = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, { env: 'live' });
      expect(res.statusCode).toBe(201);
      issued.push(res.json().key);
    }
    const sixth = await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, { env: 'live' });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json().detail).toMatch(/5 chaves live/);
    // o teto é por ambiente: teste tem as próprias 5
    expect(
      (await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, { env: 'test' })).statusCode,
    ).toBe(201);
    // rotação com graça somaria uma sexta; com graça 0 a antiga sai na hora
    const graced = await tenantReq(issued[0]!.key, 'POST', '/v1/account/keys/rotate', { graceSeconds: 3600 });
    expect(graced.statusCode).toBe(409);
    const now = await tenantReq(issued[0]!.key, 'POST', '/v1/account/keys/rotate', { graceSeconds: 0 });
    expect(now.statusCode).toBe(201);
    await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${issued[1]!.id}/revoke`);
    expect(
      (await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, { env: 'live' })).statusCode,
    ).toBe(201);
  });
});

describe('ambiente e formato da chave (docs/politica-de-chaves.md §1)', () => {
  it('prefixo trocado (gs_test_ ↔ gs_live_) → 401; chave legada sem checksum segue até a migração', async () => {
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'ambiente-chave',
      name: 'Ambiente',
      plan: 'core_data',
      key: { env: 'test' },
    });
    const key = res.json().key.key as string;
    expect(key).toMatch(/^gs_test_[0-9a-f]{12}_[A-Za-z0-9_-]{43}_[0-9a-f]{8}$/);
    expect((await tenantReq(key, 'GET', '/v1/sports')).statusCode).toBe(200);
    const p = parseApiKey(key)!;
    expect((await tenantReq(formatApiKey('live', p.prefix, p.secret), 'GET', '/v1/sports')).statusCode).toBe(
      401,
    );
    // chave de teste: limite fixo de 60 por rota e uso contado à parte
    const me = await tenantReq(key, 'GET', '/v1/sports');
    expect(me.headers['x-ratelimit-limit']).toBe('60');

    // formato 1 (emitida antes do checksum): ainda lida no formato antigo até keys:migrate revogá-la
    await db.update(apiKey).set({ keyFormat: 1 }).where(eq(apiKey.prefix, p.prefix));
    expect((await tenantReq(`gs_test_${p.prefix}_${p.secret}`, 'GET', '/v1/sports')).statusCode).toBe(200);
  });
});

describe('migração das chaves legadas (keys:migrate, docs/runbooks/migracao-de-chaves.md)', () => {
  it('--plan não muda nada; --apply revoga cada legada e reemite no formato 2, com o ambiente corrigido', async () => {
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'legado',
      name: 'Legado',
      plan: 'core_data',
      key: { label: 'producao' },
    });
    const liveKey = res.json().key.key as string;
    const testKey = (
      await adminReq('POST', `/internal/admin/tenants/legado/keys`, { label: 'homolog', env: 'test' })
    ).json().key.key as string;
    const live = parseApiKey(liveKey)!;
    const test = parseApiKey(testKey)!;
    // estado de antes do checksum: formato 1 e, na de teste, o ambiente gravado errado (C18)
    await db.update(apiKey).set({ keyFormat: 1 }).where(eq(apiKey.prefix, live.prefix));
    await db.update(apiKey).set({ keyFormat: 1, env: 'live' }).where(eq(apiKey.prefix, test.prefix));
    const legacyLive = `gs_live_${live.prefix}_${live.secret}`;
    const legacyTest = `gs_test_${test.prefix}_${test.secret}`;
    expect((await tenantReq(legacyLive, 'GET', '/v1/sports')).statusCode).toBe(200);
    // a de teste com o ambiente errado no banco já não autentica (é o que a migração conserta)
    expect((await tenantReq(legacyTest, 'GET', '/v1/sports')).statusCode).toBe(401);

    const mine = <T extends { tenant: string }>(rows: T[]) => rows.filter((r) => r.tenant === 'legado');
    const plan = mine(await planKeyMigration(db, { testPrefixes: [test.prefix] }));
    expect(plan.map((k) => [k.prefix, k.storedEnv, k.newEnv])).toEqual([
      [live.prefix, 'live', 'live'],
      [test.prefix, 'live', 'test'],
    ]);
    expect((await tenantReq(legacyLive, 'GET', '/v1/sports')).statusCode).toBe(200); // --plan não mexe

    const done = mine(await applyKeyMigration(db, { testPrefixes: [test.prefix] }));
    expect(done).toHaveLength(2);
    const [newLive, newTest] = done;
    expect(newLive!.newKey).toMatch(/^gs_live_[0-9a-f]{12}_[A-Za-z0-9_-]{43}_[0-9a-f]{8}$/);
    expect(newTest!.newKey).toMatch(/^gs_test_/);
    expect((await tenantReq(legacyLive, 'GET', '/v1/sports')).statusCode).toBe(401);
    expect((await tenantReq(newLive!.newKey, 'GET', '/v1/sports')).statusCode).toBe(200);
    const me = await tenantReq(newTest!.newKey, 'GET', '/v1/account');
    expect(me.json().key).toMatchObject({ label: 'homolog', env: 'test' });
    // idempotente
    expect(mine(await applyKeyMigration(db))).toEqual([]);
  });

  it('--apply que falha na 2ª chave já entregou a 1ª substituta e para, dizendo o que foi migrado', async () => {
    await adminReq('POST', '/internal/admin/tenants', {
      slug: 'legado-falha',
      name: 'Legado com falha',
      plan: 'core_data',
      key: { label: 'primeira', env: 'live' },
    });
    await adminReq('POST', '/internal/admin/tenants/legado-falha/keys', { label: 'segunda', env: 'live' });
    const ids = await db
      .select({ id: apiKey.id })
      .from(apiKey)
      .innerJoin(tenant, eq(tenant.id, apiKey.tenantId))
      .where(eq(tenant.slug, 'legado-falha'));
    for (const { id } of ids) await db.update(apiKey).set({ keyFormat: 1 }).where(eq(apiKey.id, id));
    // a substituta da 2ª falha ao ser gravada (a 1ª já fez commit)
    await db.execute(sql`create function test_falha_migracao() returns trigger language plpgsql as $$
      begin
        if new.label = 'segunda' and new.key_format = 2 then raise exception 'falha simulada na 2ª chave'; end if;
        return new;
      end $$`);
    await db.execute(sql`create trigger test_falha_migracao before insert on api.api_key
      for each row execute function test_falha_migracao()`);
    const printed: { tenant: string; label: string | null; newKey: string }[] = [];
    let err: unknown;
    try {
      await applyKeyMigration(db, { onMigrated: (k) => void printed.push(k) });
    } catch (e) {
      err = e;
    } finally {
      await db.execute(sql`drop trigger test_falha_migracao on api.api_key`);
      await db.execute(sql`drop function test_falha_migracao()`);
    }
    const mine = printed.filter((k) => k.tenant === 'legado-falha');
    expect(mine.map((k) => k.label)).toEqual(['primeira']);
    expect(err).toBeInstanceOf(KeyMigrationError);
    const failure = err as KeyMigrationError;
    expect(failure.failed).toMatchObject({ tenant: 'legado-falha', label: 'segunda' });
    // a mensagem traz a causa do Postgres, não a query do driver com o hash da chave
    expect(failure.message).toContain('falha simulada na 2ª chave');
    expect(failure.message).not.toContain('scrypt');
    expect(failure.migrated.map((k) => k.newKey)).toEqual(printed.map((k) => k.newKey));
    // a 1ª substituta entregue vale; a 2ª legada continua como estava (válida, formato 1)
    expect((await tenantReq(mine[0]!.newKey, 'GET', '/v1/sports')).statusCode).toBe(200);
    const left = await planKeyMigration(db);
    expect(left.filter((k) => k.tenant === 'legado-falha').map((k) => k.label)).toEqual(['segunda']);
    // corrigida a causa, rodar de novo continua de onde parou
    const rest = (await applyKeyMigration(db)).filter((k) => k.tenant === 'legado-falha');
    expect(rest.map((k) => k.label)).toEqual(['segunda']);
  });
});

describe('tenant:create no teto de chaves (upsertTenantWithKey)', () => {
  const input = (name: string, plan: 'core_data' | 'enterprise') => ({
    slug: 'cli-teto',
    name,
    ...resolveTenantValues(plans, { plan }),
  });

  it('cria o tenant e a chave juntos; no teto, falha sem reescrever o tenant', async () => {
    const first = await upsertTenantWithKey(db, input('Original', 'core_data'), { env: 'live' });
    expect(first.tenant.created).toBe(true);
    expect((await tenantReq(first.key.key, 'GET', '/v1/sports')).statusCode).toBe(200);
    for (let i = 0; i < 4; i++)
      await upsertTenantWithKey(db, input('Original', 'core_data'), { env: 'live' });
    const before = await db.select().from(tenant).where(eq(tenant.slug, 'cli-teto'));

    await expect(
      upsertTenantWithKey(db, input('Trocado', 'enterprise'), { env: 'live', label: 'sexta' }),
    ).rejects.toBeInstanceOf(KeyPolicyError);
    const after = await db.select().from(tenant).where(eq(tenant.slug, 'cli-teto'));
    expect(after).toEqual(before);
    expect(after[0]).toMatchObject({ name: 'Original', plan: 'core_data' });
    const keys = await db.select({ id: apiKey.id }).from(apiKey).where(eq(apiKey.tenantId, first.tenant.id));
    expect(keys).toHaveLength(5);
    // nem a auditoria registra a emissão recusada
    const events = (await adminReq('GET', '/internal/admin/tenants/cli-teto/key-events')).json()
      .data as unknown[];
    expect(events).toHaveLength(5);

    // o teto é por ambiente: em test, atualiza o tenant e emite
    const test = await upsertTenantWithKey(db, input('Trocado', 'enterprise'), { env: 'test' });
    expect(test.tenant.created).toBe(false);
    expect(test.key.key).toMatch(/^gs_test_/);
    const [updated] = await db.select().from(tenant).where(eq(tenant.slug, 'cli-teto'));
    expect(updated).toMatchObject({ name: 'Trocado', plan: 'enterprise' });
  });
});

describe('trial e auditoria (docs/politica-de-chaves.md §3 e §5)', () => {
  it('plano trial: 30 dias, cota baixa; no fim do prazo nenhuma chave vale; sair do trial tira o prazo', async () => {
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'avaliacao',
      name: 'Avaliação',
      plan: 'trial',
    });
    expect(res.statusCode).toBe(201);
    const t = res.json().tenant;
    expect(t).toMatchObject({ plan: 'trial', modules: ['core_data'], dailyRequestQuota: 5000 });
    const days = (Date.parse(t.trialEndsAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    const key = res.json().key.key as string;
    const ok = await tenantReq(key, 'GET', '/v1/sports');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-galaxie-quota-limit']).toBe('5000');

    await db
      .update(tenant)
      .set({ trialEndsAt: new Date(Date.now() - 1000) })
      .where(eq(tenant.id, t.id));
    expect((await tenantReq(key, 'GET', '/v1/sports')).statusCode).toBe(401);

    const upgraded = await adminReq('PATCH', `/internal/admin/tenants/${t.id}`, { plan: 'core_data' });
    expect(upgraded.json().tenant.trialEndsAt).toBeNull();
    expect((await tenantReq(key, 'GET', '/v1/sports')).statusCode).toBe(200);
  });

  it('cota depois de o Valkey perder o hash do dia: o uso já consolidado continua contando', async () => {
    await awayFromUtcMidnight();
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'cota-pos-perda',
      name: 'Cota pós-perda',
      plan: 'core_data',
      dailyRequestQuota: 3,
      key: { env: 'live' },
    });
    const tenantId = res.json().tenant.id as string;
    const key = res.json().key.key as string;
    // uso de hoje consolidado de uma época anterior; o hash do Valkey sumiu (reinício sem dados)
    const day = utcDay();
    await db.insert(usageDaily).values([
      { tenantId, day, route: 'GET /v1/sports', requests: 4, epoch: '000000000000001-antiga', epochBase: 0 },
      {
        tenantId,
        day,
        route: 'test:GET /v1/sports',
        requests: 50,
        epoch: '000000000000001-antiga',
        epochBase: 0,
      },
    ]);
    expect(await usage.get(day, tenantId)).toEqual({});
    const blocked = await tenantReq(key, 'GET', '/v1/sports');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'QUOTA_EXCEEDED' });

    // consolidado de uma época anterior + contagem da época nova do Valkey: soma (a regra do /v1/account/usage)
    const guard = new QuotaGuard(usage, { db });
    const other = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'cota-pos-perda-2',
      name: 'Cota pós-perda 2',
      plan: 'core_data',
      key: false,
    });
    const otherId = other.json().tenant.id as string;
    await db.insert(usageDaily).values({
      tenantId: otherId,
      day,
      route: 'GET /v1/sports',
      requests: 6,
      epoch: '000000000000001-antiga',
      epochBase: 0,
    });
    await usage.incr([{ day, tenantId: otherId, route: 'GET /v1/sports', n: 4 }]);
    expect(await guard.check(otherId, 10)).toMatchObject({ used: 11, level: 'warn' });
    expect(await guard.check(otherId, 10)).toMatchObject({ used: 12, level: 'blocked' });
  });

  it('emissão, rotação e revogação ficam na auditoria (sem segredo)', async () => {
    const res = await adminReq('POST', '/internal/admin/tenants', {
      slug: 'auditado',
      name: 'Auditado',
      plan: 'core_data',
    });
    const tenantId = res.json().tenant.id as string;
    const first = res.json().key;
    const issued = (
      await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys`, { label: 'extra' })
    ).json().key;
    const rotated = await tenantReq(first.key, 'POST', '/v1/account/keys/rotate', { graceSeconds: 60 });
    expect(rotated.statusCode).toBe(201);
    await adminReq('POST', `/internal/admin/tenants/${tenantId}/keys/${issued.id}/revoke`);

    const events = await adminReq('GET', `/internal/admin/tenants/auditado/key-events`);
    expect(events.statusCode).toBe(200);
    const rows = (
      events.json().data as { action: string; actor: string; prefix: string; keyKind: string }[]
    ).reverse();
    expect(rows.map((e) => [e.action, e.actor, e.prefix])).toEqual([
      ['issued', 'admin', first.prefix],
      ['issued', 'admin', issued.prefix],
      ['rotated', 'tenant', first.prefix],
      ['revoked', 'admin', issued.prefix],
    ]);
    expect(rows.every((e) => e.keyKind === 'secret')).toBe(true);
    // nunca o segredo
    expect(events.body).not.toContain(first.key);
    expect(events.body).not.toContain(rotated.json().key.key);
  });
});
