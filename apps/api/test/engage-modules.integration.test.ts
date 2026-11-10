import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, ENGAGE_MODULES, runMigrations, type Database } from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { persistModuleUsage, RedisModuleUsageMeter } from '../src/engage/module-usage.js';
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
const ADMIN_KEY = generateAdminKey();

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let meter: RedisModuleUsageMeter;

const adminReq = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  meter = new RedisModuleUsageMeter(redis, keyPrefix);
  app = buildServer({
    db,
    redis,
    keyPrefix,
    moduleUsage: meter,
    usagePersist: false,
    authenticator: { cacheTtlMs: 0 },
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
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

async function newTenant(slug: string, modules?: string[]) {
  const res = await adminReq('POST', '/internal/admin/tenants', {
    slug,
    name: slug,
    plan: 'enterprise',
    ...(modules ? { modules } : {}),
    key: false,
  });
  expect(res.statusCode).toBe(201);
  return res.json().tenant as { id: string; modules: string[] };
}

describe('módulos de engajamento (#1018)', () => {
  it('o plano Enterprise não traz nenhum módulo de engajamento; o contrato liga um a um', async () => {
    const plain = await newTenant('ent-sem-engajamento');
    expect(plain.modules.filter((m) => (ENGAGE_MODULES as readonly string[]).includes(m))).toEqual([]);
    const withChat = await newTenant('ent-com-chat', ['core_data', 'live_chat', 'gamification']);
    const res = await adminReq('GET', `/internal/admin/tenants/${withChat.id}/engage-modules`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modules).toEqual(['live_chat', 'gamification']);
    // faixas só dos módulos ligados, no padrão da Galaxie
    expect(body.limits.map((l: { key: string }) => l.key)).toEqual([
      'live_chat.peak_connections',
      'gamification.max_programs',
    ]);
    expect(body.limits[0]).toMatchObject({ value: 5000, custom: false, tiers: [5000, 25000, 100000] });
  });

  it('faixa fora do teto ou fora das faixas fixas → 400; null volta ao padrão', async () => {
    const t = await newTenant('ent-faixas', ['core_data', 'live_chat', 'communities']);
    const bad = await adminReq('PUT', `/internal/admin/tenants/${t.id}/module-limits`, {
      limits: { 'live_chat.peak_connections': 30000 },
    });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain('5000, 25000, 100000');
    const over = await adminReq('PUT', `/internal/admin/tenants/${t.id}/module-limits`, {
      limits: { 'communities.max_communities': 501 },
    });
    expect(over.statusCode).toBe(400);
    const unknown = await adminReq('PUT', `/internal/admin/tenants/${t.id}/module-limits`, {
      limits: { 'chat.qualquer': 1 },
    });
    expect(unknown.statusCode).toBe(400);

    const ok = await adminReq('PUT', `/internal/admin/tenants/${t.id}/module-limits`, {
      limits: { 'live_chat.peak_connections': 25000, 'communities.max_communities': 12 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().limits).toEqual([
      expect.objectContaining({ key: 'live_chat.peak_connections', value: 25000, custom: true }),
      expect.objectContaining({ key: 'communities.max_communities', value: 12, custom: true }),
    ]);
    const reset = await adminReq('PUT', `/internal/admin/tenants/${t.id}/module-limits`, {
      limits: { 'communities.max_communities': null },
    });
    expect(reset.json().limits[1]).toMatchObject({ value: 5, custom: false });
  });

  it('mede torcedores distintos, pico e contadores e consolida sem nunca diminuir', async () => {
    const t = await newTenant('ent-uso', ['core_data', 'live_chat', 'shopping', 'cosmos_ai']);
    for (const p of ['p1', 'p2', 'p2', 'p3']) await meter.fanActive(t.id, 'live_chat', p);
    await meter.connections(t.id, 'live_chat', 120);
    await meter.connections(t.id, 'live_chat', 80);
    await meter.add(t.id, 'shopping', 'clicks', 7);
    await meter.add(t.id, 'cosmos_ai', 'credits', 30);
    expect(await persistModuleUsage(db, meter)).toEqual({ rows: 4 });

    // Valkey perde o mês: o consolidado fica com o maior já visto
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}engage:usage:*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    await meter.connections(t.id, 'live_chat', 10);
    await persistModuleUsage(db, meter);

    const res = await adminReq('GET', `/internal/admin/tenants/${t.id}/engage-modules`);
    const usage = res.json().usage as { module: string; metric: string; value: number }[];
    expect(usage).toEqual([
      { module: 'cosmos_ai', metric: 'credits', value: 30 },
      { module: 'live_chat', metric: 'active_fans', value: 3 },
      { module: 'live_chat', metric: 'peak_connections', value: 120 },
      { module: 'shopping', metric: 'clicks', value: 7 },
    ]);
  });

  it('uso de tenant removido é ignorado na consolidação', async () => {
    await meter.add('00000000-0000-7000-8000-000000000000', 'shopping', 'clicks', 3);
    await expect(persistModuleUsage(db, meter)).resolves.toBeDefined();
  });
});
