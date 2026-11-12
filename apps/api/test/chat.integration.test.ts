import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySanction, closeDb, createDb, runMigrations, type Database } from '@galaxie/db';
import { sql } from 'drizzle-orm';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { ChatSettings } from '../src/chat/settings.js';
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
const MIN = 60_000;

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let clock = Date.now();

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
    now: () => new Date(clock),
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

const fan = async (key: string, n: number, ageBand = '18plus') => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fans/tokens',
    headers: { 'x-galaxie-key': key },
    payload: {
      externalAccountId: `acc_${n}`,
      externalProfileId: `prof_${n}`,
      nickname: `Torcedor${n}`,
      ageBand,
      country: 'br',
      locale: 'pt-BR',
    },
  });
  expect(res.statusCode).toBe(201);
  return {
    token: res.json().data.token as string,
    profileId: res.json().data.profile_id as string,
  };
};

/** Jogo que começa `startsInMin` minutos depois do relógio do teste. */
async function game(startsInMin: number, status = 'scheduled'): Promise<string> {
  const [sport] = await db.execute<{ slug: string }>(sql`select slug from core.sport limit 1`);
  const slug =
    sport?.slug ??
    (
      await db.execute(
        sql`insert into core.sport (slug, name) values ('football', '{"pt-BR":"Futebol"}') returning slug`,
      )
    )[0]!.slug;
  const starts = new Date(clock + startsInMin * MIN);
  const ends = new Date(starts.getTime() + 110 * MIN);
  const [row] = await db.execute<{ id: string }>(
    sql`insert into core.event (sport, starts_at, ends_at_expected, status)
        values (${slug}, ${starts.toISOString()}, ${ends.toISOString()}, ${status}) returning id`,
  );
  return row!.id;
}

const room = (key: string, fixtureId: string) =>
  app.inject({ method: 'GET', url: `/v1/chat/rooms/${fixtureId}`, headers: { 'x-galaxie-key': key } });
const send = (token: string, fixtureId: string, body: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/chat/rooms/${fixtureId}/messages`,
    headers: { authorization: `Bearer ${token}` },
    payload: { body },
  });

describe('Chat ao vivo: salas (#959)', () => {
  it('sala por jogo e por cliente: dois clientes no mesmo jogo não se veem', async () => {
    clock = Date.now();
    const a = await tenantKey('chat-a', ['core_data', 'live_chat']);
    const b = await tenantKey('chat-b', ['core_data', 'live_chat']);
    const fixture = await game(10);
    const fa = await fan(a.key, 1);

    const ra = await room(a.key, fixture);
    expect(ra.statusCode).toBe(200);
    expect(ra.headers['x-robots-tag']).toContain('noindex');
    expect(ra.json().data).toMatchObject({ fixture_id: fixture, state: 'open', messages: [] });

    const sent = await send(fa.token, fixture, 'Vamos, time!');
    expect(sent.statusCode).toBe(201);
    expect(sent.json().data).toMatchObject({ body: 'Vamos, time!', status: 'published' });
    expect(sent.json().data.author).toMatchObject({ profile_id: fa.profileId, nickname: 'Torcedor1' });

    const again = await room(a.key, fixture);
    expect(again.json().data.room_id).toBe(ra.json().data.room_id);
    expect(again.json().data.messages.map((m: { body: string }) => m.body)).toEqual(['Vamos, time!']);

    const rb = await room(b.key, fixture);
    expect(rb.statusCode).toBe(200);
    expect(rb.json().data.room_id).not.toBe(ra.json().data.room_id);
    expect(rb.json().data.messages).toEqual([]);

    // o banco recusa mensagem do cliente B apontando para a sala do cliente A
    await expect(
      db.execute(
        sql`insert into chat.message (tenant_id, room_id, profile_id, body, purge_at)
            values (${b.id}, ${ra.json().data.room_id}, ${fa.profileId}, 'x', now())`,
      ),
    ).rejects.toThrow();
  });

  it('sem live_chat: ler e enviar recusam', async () => {
    clock = Date.now();
    const t = await tenantKey('chat-sem', ['core_data', 'communities']);
    const fixture = await game(10);
    const f = await fan(t.key, 1);
    expect((await room(t.key, fixture)).json().code).toBe('MODULE_NOT_IN_PLAN');
    const res = await send(f.token, fixture, 'oi');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MODULE_NOT_IN_PLAN');
  });

  it('13_17 lê e recebe 403 no envio; under13 não entra', async () => {
    clock = Date.now();
    const t = await tenantKey('chat-idade', ['core_data', 'live_chat']);
    const fixture = await game(10);
    const teen = await fan(t.key, 1, '13_17');
    const kid = await fan(t.key, 2, 'under13');
    const res = await send(teen.token, fixture, 'oi');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FAN_AGE_RESTRICTED' });
    expect(res.json().detail).toMatch(/maiores de 18/);
    expect((await send(kid.token, fixture, 'oi')).statusCode).toBe(403);
  });

  it('congelada recusa envio, reabre, e encerrada fica só leitura', async () => {
    clock = Date.now();
    const t = await tenantKey('chat-estado', ['core_data', 'live_chat']);
    const fixture = await game(5);
    const f = await fan(t.key, 1);
    expect((await send(f.token, fixture, 'antes')).statusCode).toBe(201);

    const frozen = await app.inject({
      method: 'PATCH',
      url: `/v1/chat/rooms/${fixture}`,
      headers: { 'x-galaxie-key': t.key },
      payload: { state: 'frozen' },
    });
    expect(frozen.statusCode).toBe(200);
    expect(frozen.json().data.state).toBe('frozen');
    const refused = await send(f.token, fixture, 'durante');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().errors).toEqual([{ path: 'refusal', message: 'room_frozen' }]);

    await app.inject({
      method: 'PATCH',
      url: `/v1/chat/rooms/${fixture}`,
      headers: { 'x-galaxie-key': t.key },
      payload: { state: 'open' },
    });
    // modo lento padrão (3 s): mandar de novo na hora → 429
    expect((await send(f.token, fixture, 'depois')).statusCode).toBe(429);
    clock += 5_000;
    expect((await send(f.token, fixture, 'depois')).statusCode).toBe(201);

    // fim previsto + 30 min de margem: encerrada, as mensagens continuam para leitura
    clock += 200 * MIN;
    const closed = await room(t.key, fixture);
    expect(closed.json().data.state).toBe('closed');
    expect(closed.json().data.messages).toHaveLength(2);
    const late = await send(f.token, fixture, 'tarde');
    expect(late.statusCode).toBe(409);
    expect(late.json().errors[0].message).toBe('room_closed');
  });

  it('antes da janela a sala ainda não abriu; o cliente muda a janela', async () => {
    clock = Date.now();
    const t = await tenantKey('chat-janela', ['core_data', 'live_chat']);
    const fixture = await game(120);
    const f = await fan(t.key, 1);
    expect((await room(t.key, fixture)).json().data.state).toBe('scheduled');
    expect((await send(f.token, fixture, 'cedo')).json().errors[0].message).toBe('room_scheduled');

    const cfg = await app.inject({
      method: 'PUT',
      url: '/v1/chat/config',
      headers: { 'x-galaxie-key': t.key },
      payload: { openBeforeMinutes: 180, slowModeSeconds: 0 },
    });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().data).toMatchObject({
      open_before_minutes: 180,
      slow_mode_seconds: 0,
      custom: ['openBeforeMinutes', 'slowModeSeconds'],
    });
    expect((await room(t.key, fixture)).json().data.state).toBe('open');
    expect((await send(f.token, fixture, 'agora')).statusCode).toBe(201);
    expect((await send(f.token, fixture, 'sem modo lento')).statusCode).toBe(201);
  });

  it('filtro e punição: link recusa e Silenciar na sala recusa o envio', async () => {
    clock = Date.now();
    const t = await tenantKey('chat-mod', ['core_data', 'live_chat']);
    const fixture = await game(5);
    await app.inject({
      method: 'PUT',
      url: '/v1/chat/config',
      headers: { 'x-galaxie-key': t.key },
      payload: { slowModeSeconds: 0 },
    });
    const f = await fan(t.key, 1);
    const link = await send(f.token, fixture, 'olha https://exemplo-qualquer.test/x');
    expect(link.statusCode).toBe(400);

    const roomId = (await room(t.key, fixture)).json().data.room_id as string;
    await applySanction(db, {
      tenantId: t.id,
      profileId: f.profileId,
      accountId: null,
      level: 'mute',
      hidden: false,
      scope: 'place',
      scopeId: roomId,
      reason: 'harassment',
      caseId: null,
      actor: { id: 'user:mod1', kind: 'person' },
      endsAt: new Date(clock + 60 * MIN),
      now: new Date(clock - 1000),
      clocks: {
        contentPurgeAt: new Date(clock + 30 * 24 * 60 * MIN),
        decisionPurgeAt: new Date(clock + 365 * 24 * 60 * MIN),
      },
    });
    const muted = await send(f.token, fixture, 'oi');
    expect(muted.statusCode).toBe(409);
    expect(muted.json().errors[0].message).toBe('sanctioned');
  });
});

describe('ChatSettings', () => {
  it('lê o padrão do registro', async () => {
    expect(await new ChatSettings(undefined).get()).toMatchObject({
      openBeforeMinutes: 60,
      closeAfterMinutes: 30,
      slowModeSeconds: 3,
      maxChars: 280,
      historyOnJoin: 50,
    });
  });
});
