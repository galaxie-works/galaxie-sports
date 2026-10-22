import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  broadcastOption,
  closeDb,
  competition,
  createDb,
  event,
  eventIncident,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
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
const MAX_CONNECTIONS = 4;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
/** Duas instâncias da API compartilhando banco e Valkey (fan-out horizontal). */
let apiA: FastifyInstance;
let apiB: FastifyInstance;
let baseA: string;
let baseB: string;
let key: string;
let coreKey: string;
const cdn = new RecordingCdnPurger();
const ev: Record<string, string> = {};
const clients: SseClient[] = [];
/** Latências medidas (mudança no banco → mensagem SSE), em ms. */
const latencies: Record<string, number> = {};

const open = async (
  base: string,
  path: string,
  headers: Record<string, string> = { 'x-galaxie-key': key },
) => {
  const c = await openSse(`${base}${path}`, headers);
  clients.push(c);
  return c;
};
const parse = (data: string) =>
  JSON.parse(data) as Record<string, unknown> & { data: Record<string, unknown> };

async function newEvent(): Promise<string> {
  const now = Date.now();
  const [row] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: ev.competition!,
      startsAt: new Date(now - 20 * 60_000),
      endsAtExpected: new Date(now + 95 * 60_000),
      status: 'live',
      score: { home: 0, away: 0 },
      clock: { minute: 20, extra: null, period: '1H' },
    })
    .returning();
  return row!.id;
}

const setScore = (id: string, home: number, away = 0) =>
  db.update(event).set({ score: { home, away } }).where(eq(event.id, id));

async function start(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 10 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'serie-a', name: 'Serie A', type: 'league', tier: 1 })
    .returning();
  ev.competition = comp!.id;

  const t = await upsertTenant(db, { slug: 'tv', name: 'TV', plan: 'enterprise', rateLimitPerMinute: 1000 });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  const c = await upsertTenant(db, {
    slug: 'radio',
    name: 'Rádio',
    plan: 'core_data',
    rateLimitPerMinute: 1000,
  });
  coreKey = (await createApiKey(db, c.id, { env: 'test' })).key;

  const realtime = { pollIntervalMs: 200, heartbeatMs: 300, maxConnectionsPerTenant: MAX_CONNECTIONS };
  apiA = buildServer({
    db,
    redis,
    keyPrefix,
    cdnPurger: cdn,
    changeFeed: { pollIntervalMs: 250 },
    realtime,
  });
  apiB = buildServer({ db, redis, keyPrefix, realtime });
  baseA = await start(apiA);
  baseB = await start(apiB);
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.close();
  await apiA?.close();
  await apiB?.close();
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
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
  if (Object.keys(latencies).length) console.log('latências SSE (ms):', latencies);
});

describe('GET /v1/stream (SSE)', () => {
  it('trigger → change_feed → SSE nas duas instâncias, em ≤ 5 s', async () => {
    const id = await newEvent();
    const onA = await open(baseA, `/v1/stream?events=${id}&topics=score`);
    const onB = await open(baseB, `/v1/stream?events=${id}&topics=score`);
    expect(onB.status).toBe(200);
    expect(onB.headers['content-type']).toContain('text/event-stream');
    expect(onB.headers['cache-control']).toContain('no-store');
    expect(onB.headers['x-ratelimit-limit']).toBe('1000');
    await onA.waitFor((m) => m.event === 'ready');
    await onB.waitFor((m) => m.event === 'ready');

    const t0 = Date.now();
    await setScore(id, 1);
    const [a, b] = await Promise.all([
      onA.waitFor((m) => m.event === 'event.score_changed'),
      onB.waitFor((m) => m.event === 'event.score_changed'),
    ]);
    latencies.score = Math.max(a.receivedAt, b.receivedAt) - t0;
    expect(latencies.score).toBeLessThan(5_000);
    expect(a.id).toBe(b.id);
    expect(parse(b.data)).toMatchObject({
      id: b.id,
      topic: 'event.score_changed',
      event_id: id,
      sport: 'football',
      competition_id: ev.competition,
      changed: ['score'],
      data: { score: { home: 1, away: 0 } },
    });
    // uma única entrega por instância, mesmo com o relay publicando via Valkey
    await new Promise((r) => setTimeout(r, 300));
    expect(onB.messages.filter((m) => m.event === 'event.score_changed')).toHaveLength(1);
    onA.close();
    onB.close();
  });

  it('filtra por evento e tópico; envia heartbeats', async () => {
    const id = await newEvent();
    const other = await newEvent();
    const c = await open(baseB, `/v1/stream?events=${id}&topics=status,incidents`);
    await c.waitFor((m) => m.event === 'ready');
    await setScore(id, 2); // tópico não pedido
    await setScore(other, 3); // evento não pedido
    await db.update(event).set({ status: 'break', statusDetail: 'HT' }).where(eq(event.id, other));
    const t0 = Date.now();
    await db.update(event).set({ status: 'break', statusDetail: 'HT' }).where(eq(event.id, id));
    const status = await c.waitFor((m) => m.event === 'event.status_changed');
    latencies.status = status.receivedAt - t0;
    expect(parse(status.data)).toMatchObject({
      event_id: id,
      changed: ['status', 'status_detail'],
      data: { status: 'break', status_detail: 'HT' },
      previous: { status: 'live' },
    });

    await db.insert(eventIncident).values({ eventId: id, sequence: 0, minute: 44, type: 'goal' });
    const inc = await c.waitFor((m) => m.event === 'event.incident_added');
    expect(parse(inc.data).data).toMatchObject({ incidents: [{ sequence: 0, minute: 44, type: 'goal' }] });

    await new Promise((r) => setTimeout(r, 400));
    expect(c.messages.map((m) => m.event)).toEqual(['ready', 'event.status_changed', 'event.incident_added']);
    expect(c.raw()).toContain(': hb ');
    c.close();
  });

  it('retoma com Last-Event-ID: reenvia do change_feed o que foi perdido, em ordem e sem repetir', async () => {
    const id = await newEvent();
    const first = await open(baseA, `/v1/stream?events=${id}&topics=score`);
    await first.waitFor((m) => m.event === 'ready');
    await setScore(id, 1);
    const seen = await first.waitFor((m) => m.event === 'event.score_changed');
    first.close();

    // desconectado: duas mudanças
    await setScore(id, 2);
    await setScore(id, 3);

    const resumed = await open(baseB, `/v1/stream?events=${id}&topics=score`, {
      'x-galaxie-key': key,
      'last-event-id': seen.id!,
    });
    const ready = await resumed.waitFor((m) => m.event === 'ready');
    const replayed = resumed.messages.filter((m) => m.event === 'event.score_changed');
    expect(replayed.map((m) => (parse(m.data).data.score as { home: number }).home)).toEqual([2, 3]);
    expect(Number(replayed[0]!.id)).toBeGreaterThan(Number(seen.id));
    expect(Number(parse(ready.data).last_event_id)).toBeGreaterThanOrEqual(Number(replayed[1]!.id));

    // e continua ao vivo depois da retomada
    await setScore(id, 4);
    const live = await resumed.waitFor(
      (m) => m.event === 'event.score_changed' && (parse(m.data).data.score as { home: number }).home === 4,
    );
    expect(Number(live.id)).toBeGreaterThan(Number(replayed[1]!.id));
    expect(resumed.messages.filter((m) => m.event === 'event.score_changed')).toHaveLength(3);
    resumed.close();
  });

  it('aceita ?key= (EventSource), valida chave, plano e parâmetros', async () => {
    const id = await newEvent();
    const viaQuery = await open(baseA, `/v1/stream?events=${id}&key=${encodeURIComponent(key)}`, {});
    expect(viaQuery.status).toBe(200);
    const ready = await viaQuery.waitFor((m) => m.event === 'ready');
    expect(parse(ready.data).topics).toEqual([
      'event.status_changed',
      'event.score_changed',
      'event.incident_added',
      'where_to_watch.changed',
      'event.context_published',
      'event.related_content_changed',
    ]);
    viaQuery.close();

    const noKey = await open(baseA, `/v1/stream?events=${id}`, {});
    expect(noKey.status).toBe(401);
    // ?key= só vale para rotas que o permitem
    expect((await open(baseA, `/v1/sports?key=${encodeURIComponent(key)}`, {})).status).toBe(401);

    const wtw = await open(baseA, `/v1/stream?events=${id}&topics=where_to_watch`, {
      'x-galaxie-key': coreKey,
    });
    expect(wtw.status).toBe(403);
    expect(wtw.body).toMatchObject({ code: 'MODULE_NOT_IN_PLAN' });

    const bad = await open(baseA, `/v1/stream?topics=odds`);
    expect(bad.status).toBe(400);
    const badId = await open(baseA, `/v1/stream`, { 'x-galaxie-key': key, 'last-event-id': 'abc' });
    expect(badId.status).toBe(400);
  });

  it('limita conexões simultâneas por tenant em todas as instâncias', async () => {
    const t = await upsertTenant(db, {
      slug: 'app',
      name: 'App',
      plan: 'core_data',
      rateLimitPerMinute: 1000,
    });
    const k = (await createApiKey(db, t.id)).key;
    const headers = { 'x-galaxie-key': k };
    const conns = [];
    for (let i = 0; i < MAX_CONNECTIONS; i++)
      conns.push(await open(i % 2 ? baseB : baseA, '/v1/stream?topics=score', headers));
    expect(conns.map((c) => c.status)).toEqual(Array(MAX_CONNECTIONS).fill(200));
    await Promise.all(conns.map((c) => c.waitFor((m) => m.event === 'ready')));

    const extra = await open(baseB, '/v1/stream?topics=score', headers);
    expect(extra.status).toBe(429);
    expect(extra.headers['retry-after']).toBe('30');

    // fechar uma libera a vaga (o lease sai do Valkey no 'close' da conexão)
    conns[0]!.close();
    let status = 0;
    for (let i = 0; i < 30 && status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await open(baseA, '/v1/stream?topics=score', headers)).status;
    }
    expect(status).toBe(200);
  });

  it('correção de onde assistir: SSE where_to_watch.changed e purge de cache pelo trigger', async () => {
    const id = await newEvent();
    const c = await open(baseB, `/v1/stream?events=${id}&topics=where_to_watch`);
    await c.waitFor((m) => m.event === 'ready');
    const t0 = Date.now();
    await db.insert(broadcastOption).values({
      eventId: id,
      countryCode: 'BR',
      providerName: 'Canal X',
      medium: 'free_tv',
      accessModel: 'free',
      status: 'confirmed',
      confidence: '0.97',
      evidence: [],
      producedBy: 'editorial:teste',
    });
    const msg = await c.waitFor((m) => m.event === 'where_to_watch.changed');
    latencies.where_to_watch = msg.receivedAt - t0;
    expect(parse(msg.data)).toMatchObject({ event_id: id, data: { countries: ['BR'] } });
    await expect.poll(() => cdn.purged.flat(), { timeout: 5_000 }).toContain(`where_to_watch:${id}`);
    latencies.where_to_watch_purge = Date.now() - t0;
    expect(cdn.purged.flat()).toContain(`event:${id}`);
    c.close();
  });

  it('sem NOTIFY (só varredura de 1 s), a mudança ainda chega em ≤ 5 s', async () => {
    const pollOnly = buildServer({
      db,
      redis,
      keyPrefix: `${keyPrefix}poll:`,
      realtime: { listen: false, pollIntervalMs: 1_000 },
    });
    const base = await start(pollOnly);
    try {
      const id = await newEvent();
      const c = await open(base, `/v1/stream?events=${id}&topics=score`);
      await c.waitFor((m) => m.event === 'ready');
      const t0 = Date.now();
      await setScore(id, 5);
      const msg = await c.waitFor((m) => m.event === 'event.score_changed');
      latencies.score_poll_only = msg.receivedAt - t0;
      expect(latencies.score_poll_only).toBeLessThan(5_000);
    } finally {
      await pollOnly.close();
    }
  });

  it('encerra os streams abertos no close do servidor', async () => {
    const extraApp = buildServer({ db, redis, keyPrefix, realtime: { pollIntervalMs: 200 } });
    const base = await start(extraApp);
    const c = await open(base, '/v1/stream?topics=score');
    await c.waitFor((m) => m.event === 'ready');
    const t0 = Date.now();
    await extraApp.close();
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});
