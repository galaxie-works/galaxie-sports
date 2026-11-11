import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  event,
  runMigrations,
  sport,
  writePresenceLimit,
  type Database,
} from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { eraseFan } from '../src/engage/fans.js';
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

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: new FanTokenSigner({ secret: 's'.repeat(48) }),
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
  });
  await app.ready();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
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

async function tenantKey(slug: string, modules: string[]): Promise<{ id: string; key: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/tenants',
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    payload: { slug, name: slug, plan: 'enterprise', modules },
  });
  expect(res.statusCode).toBe(201);
  return { id: res.json().tenant.id, key: res.json().key.key };
}

const issue = (key: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/fans/tokens', headers: { 'x-galaxie-key': key }, payload: body });
const fan = async (key: string, n: number, ageBand = '18plus') => {
  const res = await issue(key, {
    externalAccountId: `acc_${n}`,
    externalProfileId: `prof_${n}`,
    nickname: `Torcedor${n}`,
    ageBand,
    country: 'br',
    locale: 'pt-BR',
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.token as string;
};
const game = async (status: 'live' | 'scheduled' | 'finished' = 'live') => {
  const [row] = await db
    .insert(event)
    .values({
      sport: 'football',
      startsAt: new Date(Date.now() - 30 * 60_000),
      endsAtExpected: new Date(Date.now() + 80 * 60_000),
      status,
    })
    .returning({ id: event.id });
  return row!.id;
};
const beat = (token: string, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/v1/fans/me/presence',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

describe('presença ao vivo (#906)', () => {
  it('conta só com aba visível e jogo ao vivo, e mostra quantos estão no jogo', async () => {
    const t = await tenantKey('pres-a', ['core_data', 'live_chat']);
    const [a, b] = [await fan(t.key, 1), await fan(t.key, 2)];
    const ev = await game();
    const hidden = await beat(a, { eventId: ev, visible: false });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data).toMatchObject({
      counted: false,
      reason: 'hidden',
      present: 0,
      heartbeat_s: 30,
    });
    expect((await beat(a, { eventId: ev, visible: true })).json().data).toMatchObject({
      counted: true,
      present: 1,
    });
    const second = await beat(b, { eventId: ev, visible: true, interacted: true });
    expect(second.json().data).toMatchObject({ counted: true, present: 2, interaction_due: false });
    expect(Date.parse(second.json().data.server_time)).not.toBeNaN();
    const count = await app.inject({
      method: 'GET',
      url: `/v1/events/${ev}/presence`,
      headers: { authorization: `Bearer ${a}` },
    });
    expect(count.json().data).toEqual({ event_id: ev, present: 2 });
    // outro cliente não vê os presentes deste
    const other = await tenantKey('pres-b', ['core_data', 'live_chat']);
    const c = await fan(other.key, 3);
    const otherCount = await app.inject({
      method: 'GET',
      url: `/v1/events/${ev}/presence`,
      headers: { authorization: `Bearer ${c}` },
    });
    expect(otherCount.json().data.present).toBe(0);

    expect((await beat(a, { eventId: await game('finished'), visible: true })).statusCode).toBe(409);
    expect(
      (await beat(a, { eventId: '0190f1c0-0000-7000-8000-00000000dead', visible: true })).statusCode,
    ).toBe(404);
    expect((await beat(a, { eventId: ev, visible: true, clientTime: Date.now() })).statusCode).toBe(400);
  });

  it('limite de jogos ao mesmo tempo, com o do cliente abaixo do da Galaxie', async () => {
    const t = await tenantKey('pres-c', ['core_data', 'live_chat']);
    await writePresenceLimit(db, { tenantId: t.id, maxGames: 1, updatedBy: 'panel:teste' });
    const a = await fan(t.key, 10);
    const [g1, g2] = [await game(), await game()];
    expect((await beat(a, { eventId: g1, visible: true })).json().data.counted).toBe(true);
    expect((await beat(a, { eventId: g2, visible: true })).json().data).toMatchObject({
      counted: false,
      reason: 'too_many_games',
    });
  });

  it('Perfil excluído não lê a contagem, mesmo sem a marca de exclusão no Valkey', async () => {
    const t = await tenantKey('pres-e', ['core_data', 'live_chat']);
    const a = await fan(t.key, 30);
    const ev = await game();
    const ok = await app.inject({
      method: 'GET',
      url: `/v1/events/${ev}/presence`,
      headers: { authorization: `Bearer ${a}` },
    });
    expect(ok.statusCode).toBe(200);
    // apaga só no banco: a marca no Valkey não existe, como quando ele está fora
    await eraseFan(db, {
      tenantId: t.id,
      externalAccountId: 'acc_30',
      externalProfileId: 'prof_30',
      requestedBy: 'teste',
    });
    const gone = await app.inject({
      method: 'GET',
      url: `/v1/events/${ev}/presence`,
      headers: { authorization: `Bearer ${a}` },
    });
    expect(gone.statusCode).toBe(401);
    expect(gone.json().detail).toBe('Perfil excluído.');
  });

  it('menor de 13 fica fora', async () => {
    const t = await tenantKey('pres-d', ['core_data', 'live_chat']);
    const kid = await fan(t.key, 20, 'under13');
    expect((await beat(kid, { eventId: await game(), visible: true })).statusCode).toBe(403);
  });
});
