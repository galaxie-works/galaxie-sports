import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, event, runMigrations, sport, type Database } from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { FanTokenSigner } from '../src/engage/fan-token.js';
import { buildServer } from '../src/server.js';
import { openSse, type SseClient } from './sse-client.js';

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
const signer = new FanTokenSigner({ secret: 's'.repeat(48) });
const PEAK_LIMIT = 2;

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
/** Duas instâncias da API no mesmo banco e no mesmo Valkey. */
let appA: FastifyInstance;
let appB: FastifyInstance;
let baseA: string;
let baseB: string;
const clients: SseClient[] = [];
const tenantIds = new Map<string, string>();

const server = () =>
  buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    moduleUsage: false,
    authenticator: { cacheTtlMs: 0 },
    fanTokens: signer,
    realtime: false,
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
    chat: { stream: { heartbeatMs: 1_000, peakLimitOverride: PEAK_LIMIT } },
  });

async function start(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 10 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
  appA = server();
  appB = server();
  baseA = await start(appA);
  baseB = await start(appB);
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.close();
  await appA?.close();
  await appB?.close();
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

async function tenantKey(slug: string): Promise<string> {
  const res = await appA.inject({
    method: 'POST',
    url: '/internal/admin/tenants',
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY },
    payload: { slug, name: slug, plan: 'enterprise', modules: ['core_data', 'live_chat'] },
  });
  expect(res.statusCode).toBe(201);
  const key = res.json().key.key as string;
  tenantIds.set(key, res.json().tenant.id as string);
  // sem modo lento: o teste manda várias mensagens seguidas
  await appA.inject({
    method: 'PUT',
    url: '/v1/chat/config',
    headers: { 'x-galaxie-key': key },
    payload: { slowModeSeconds: 0 },
  });
  return key;
}

async function fan(key: string, n: number): Promise<string> {
  const res = await appA.inject({
    method: 'POST',
    url: '/v1/fans/tokens',
    headers: { 'x-galaxie-key': key },
    payload: {
      externalAccountId: `acc_${n}`,
      externalProfileId: `prof_${n}`,
      nickname: `Torcedor${n}`,
      ageBand: '18plus',
      country: 'br',
      locale: 'pt-BR',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.token as string;
}

async function game(): Promise<string> {
  const now = Date.now();
  const [row] = await db
    .insert(event)
    .values({
      sport: 'football',
      startsAt: new Date(now - 20 * 60_000),
      endsAtExpected: new Date(now + 95 * 60_000),
      status: 'live',
    })
    .returning({ id: event.id });
  return row!.id;
}

const send = (base: string, token: string, fixture: string, body: string) =>
  fetch(`${base}/v1/chat/rooms/${fixture}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });

async function stream(base: string, key: string, fixture: string, headers: Record<string, string> = {}) {
  const c = await openSse(`${base}/v1/chat/rooms/${fixture}/stream`, { 'x-galaxie-key': key, ...headers });
  clients.push(c);
  return c;
}
const batches = (c: SseClient) =>
  c.messages
    .filter((m) => m.event === 'chat.batch')
    .map((m) => JSON.parse(m.data) as { batch_id: number; messages: { body: string }[] });

describe('Chat ao vivo: lotes pelo SSE (#964)', () => {
  it('mensagem enviada numa instância chega em lote à outra em até 2 s, só para o cliente dela', async () => {
    const keyA = await tenantKey('lote-a');
    const keyB = await tenantKey('lote-b');
    const fixture = await game();
    const token = await fan(keyA, 1);

    const reader = await stream(baseB, keyA, fixture);
    const other = await stream(baseB, keyB, fixture);
    expect(reader.status).toBe(200);
    expect(reader.headers['x-robots-tag']).toContain('noindex');
    await reader.waitFor((m) => m.event === 'ready');
    await other.waitFor((m) => m.event === 'ready');
    expect(JSON.parse(reader.messages.find((m) => m.event === 'chat.state')!.data)).toEqual({
      state: 'open',
    });

    const sentAt = Date.now();
    expect((await send(baseA, token, fixture, 'Golaço!')).status).toBe(201);
    expect((await send(baseA, token, fixture, 'Que jogo')).status).toBe(201);
    const got = await reader.waitFor((m) => m.event === 'chat.batch', 3_000);
    expect(got.receivedAt - sentAt).toBeLessThanOrEqual(2_000);
    await reader.waitFor(() => batches(reader).flatMap((b) => b.messages).length === 2, 3_000);
    expect(batches(reader).flatMap((b) => b.messages.map((m) => m.body))).toEqual(['Golaço!', 'Que jogo']);
    expect(got.id).toBe(`${got.id!.split('-')[0]}-${batches(reader)[0]!.batch_id}`);

    // rajada: 12 mensagens de torcedores diferentes, enviadas juntas pelas duas instâncias, saem em poucos lotes (no
    // máximo um por segundo por instância; os relógios das instâncias não andam juntos, então não é sempre um só)
    const fans = await Promise.all(Array.from({ length: 12 }, (_, i) => fan(keyA, 100 + i)));
    const before = batches(reader).length;
    const codes = await Promise.all(
      fans.map((t, i) => send(i % 2 ? baseA : baseB, t, fixture, `rajada ${i}`)),
    );
    expect(codes.every((r) => r.status === 201)).toBe(true);
    await reader.waitFor(() => batches(reader).flatMap((b) => b.messages).length === 14, 4_000);
    expect(batches(reader).length - before).toBeLessThan(12);

    // o outro cliente, no mesmo jogo e na mesma instância, não recebe nada
    await new Promise((r) => setTimeout(r, 1_500));
    expect(batches(other)).toEqual([]);
  });

  it('reconexão com Last-Event-ID recupera os lotes perdidos', async () => {
    const key = await tenantKey('lote-reconexao');
    const fixture = await game();
    const token = await fan(key, 1);
    const first = await stream(baseA, key, fixture);
    await first.waitFor((m) => m.event === 'ready');
    await send(baseB, token, fixture, 'um');
    const b1 = await first.waitFor((m) => m.event === 'chat.batch', 3_000);
    first.close();

    // fora do ar: dois lotes passam sem ele
    await send(baseB, token, fixture, 'dois');
    await new Promise((r) => setTimeout(r, 1_300));
    await send(baseB, token, fixture, 'três');
    await new Promise((r) => setTimeout(r, 1_300));

    const back = await stream(baseB, key, fixture, { 'last-event-id': b1.id! });
    await back.waitFor((m) => m.event === 'ready');
    expect(batches(back).flatMap((b) => b.messages.map((m) => m.body))).toEqual(['dois', 'três']);
    expect(back.messages.some((m) => m.event === 'chat.reset')).toBe(false);

    // cursor antigo fora do histórico: chat.reset
    await redis.del(`${keyPrefix}chat:h:${tenantIds.get(key)}:${fixture}`);
    const epoch = b1.id!.split('-')[0]!;
    const lost = await stream(baseA, key, fixture, { 'last-event-id': `${epoch}-0` });
    await lost.waitFor((m) => m.event === 'chat.reset');
    // id fora do formato: 400
    const bad = await stream(baseA, key, fixture, { 'last-event-id': 'abc' });
    expect(bad.status).toBe(400);
  });

  it('sequência perdida no Valkey: a conexão aberta recebe chat.reset e segue recebendo', async () => {
    const key = await tenantKey('lote-epoca');
    const fixture = await game();
    const token = await fan(key, 1);
    const reader = await stream(baseB, key, fixture);
    await reader.waitFor((m) => m.event === 'ready');
    await send(baseA, token, fixture, 'antes');
    await reader.waitFor((m) => m.event === 'chat.batch', 3_000);
    const room = `${tenantIds.get(key)}:${fixture}`;
    await redis.del(`${keyPrefix}chat:seq:${room}`, `${keyPrefix}chat:epoch:${room}`);
    await send(baseA, token, fixture, 'depois');
    await reader.waitFor((m) => m.event === 'chat.reset', 3_000);
    await reader.waitFor(
      () => batches(reader).some((b) => b.messages.some((m) => m.body === 'depois')),
      3_000,
    );
  });

  it('faixa de conexões estourada: quem entra lê em só leitura e torcedor novo não escreve (D6)', async () => {
    const key = await tenantKey('lote-pico');
    const fixture = await game();
    const veteran = await fan(key, 1);
    expect((await send(baseA, veteran, fixture, 'cheguei cedo')).status).toBe(201);

    const seated = [await stream(baseA, key, fixture), await stream(baseB, key, fixture)];
    for (const c of seated) await c.waitFor((m) => m.event === 'ready');
    const late = await stream(baseB, key, fixture);
    await late.waitFor((m) => m.event === 'ready');
    expect(JSON.parse(late.messages.find((m) => m.event === 'chat.state')!.data)).toEqual({
      state: 'read_only_peak',
      reason: 'peak',
    });

    const newcomer = await fan(key, 2);
    const refused = await send(baseA, newcomer, fixture, 'oi');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { errors: { message: string }[] }).errors[0]!.message).toBe(
      'room_read_only_peak',
    );
    expect((await send(baseB, veteran, fixture, 'sigo aqui')).status).toBe(201);
    // quem excedeu a faixa continua lendo
    await late.waitFor((m) => m.event === 'chat.batch', 3_000);
  });
});
