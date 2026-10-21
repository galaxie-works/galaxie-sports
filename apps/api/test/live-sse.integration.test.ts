/**
 * Ponta a ponta do ao vivo (#55): o Live Poller do ingestor faz `fixtures?live=` (cliente real da
 * api-sports com `fetch` falso, Governor e raw no Postgres), aplica o gol pela normalização e o cliente
 * SSE de `/v1/stream` recebe `event.score_changed` e `event.incident_added` em ≤ 5 s.
 *
 * Não há tópico novo: os sinais `topic = live` que o poller publica no change feed são internos (purge e
 * operação); quem chega ao SSE/webhook são as mudanças capturadas pelos triggers de `core.event` e
 * `core.event_incident` — uma vez só por mudança (docs/05 §5).
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiSportsClient,
  defaultPolicy,
  PgQuotaGovernor,
  PgRawStore,
  PlanRules,
  PRO_PLAN,
} from '@galaxie/apisports-client';
import { changeFeed, closeDb, competition, createDb, runMigrations, sport, type Database } from '@galaxie/db';
import { LivePoller, PgLiveStore, upsertBatch } from '@galaxie/ingestor';
import { ApiSportsProvider, normalizeFixtures, type ApiFixture } from '@galaxie/providers';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
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
const keyPrefix = `gs-live-${randomBytes(4).toString('hex')}:`;
const MIN = 60_000;
const FIXTURE_ID = 950001;
const LEAGUE = 71;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let base: string;
let key: string;
let eventId: string;
const clients: SseClient[] = [];
const kickoff = new Date(Date.now() - 20 * MIN);
/** Placar que o fornecedor falso devolve agora. */
let goals = 0;

/** Partida ao vivo no formato da api-sports (1º tempo; `goals` gols do mandante aos 15'). */
function liveFixture(minute: number): ApiFixture {
  return {
    fixture: {
      id: FIXTURE_ID,
      referee: null,
      timezone: 'UTC',
      date: kickoff.toISOString(),
      timestamp: Math.floor(kickoff.getTime() / 1000),
      periods: { first: Math.floor(kickoff.getTime() / 1000), second: null },
      venue: { id: null, name: null, city: null },
      status: { long: 'First Half', short: '1H', elapsed: minute, extra: null },
    },
    league: {
      id: LEAGUE,
      name: 'Serie A',
      country: 'Brazil',
      logo: null,
      flag: null,
      season: 2026,
      round: 'Regular Season - 31',
    },
    teams: {
      home: { id: 121, name: 'Palmeiras', logo: null, winner: null },
      away: { id: 131, name: 'Corinthians', logo: null, winner: null },
    },
    goals: { home: goals, away: 0 },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    events: Array.from({ length: goals }, (_, i) => ({
      time: { elapsed: 15 + i, extra: null },
      team: { id: 121, name: 'Palmeiras' },
      player: { id: null, name: 'Atacante A' },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    })),
  } as unknown as ApiFixture;
}

/** `fetch` falso da api-sports: só responde `fixtures?live=`. */
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const live = url.searchParams.get('live');
  const response = url.pathname === '/fixtures' && live ? [liveFixture(20)] : [];
  return new Response(
    JSON.stringify({
      get: 'fixtures',
      parameters: Object.fromEntries(url.searchParams),
      errors: [],
      results: response.length,
      paging: { current: 1, total: 1 },
      response,
    }),
    { headers: { 'content-type': 'application/json', 'x-ratelimit-requests-remaining': '100' } },
  );
}) as typeof globalThis.fetch;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 10 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });

  // core como o sync diário + ticks anteriores deixaram: jogo no 1º tempo, 0 x 0
  const seededAt = new Date(kickoff.getTime() + 10 * MIN);
  await upsertBatch(db, normalizeFixtures([liveFixture(10)], seededAt));
  await db.update(competition).set({ tier: 1, livePriority: 'high' });
  const [row] = await db.execute<{ id: string }>(
    sql`select entity_id as id from core.provider_map
         where entity_type = 'event' and provider_id = ${String(FIXTURE_ID)}`,
  );
  eventId = row!.id;

  const t = await upsertTenant(db, { slug: 'tv', name: 'TV', plan: 'enterprise', rateLimitPerMinute: 1000 });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  app = buildServer({ db, redis, keyPrefix, realtime: { pollIntervalMs: 1_000, heartbeatMs: 15_000 } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.close();
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
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('Live Poller → change feed → SSE', () => {
  it('gol aplicado pelo poller chega ao cliente SSE em ≤ 5 s, sem duplicata e sem o tópico interno', async () => {
    const sse = await openSse(`${base}/v1/stream?events=${eventId}&topics=score,incidents,status`, {
      'x-galaxie-key': key,
    });
    clients.push(sse);
    expect(sse.status).toBe(200);
    await sse.waitFor((m) => m.event === 'ready');

    const client = new ApiSportsClient({
      apiKey: 'test-key',
      store: new PgRawStore(db),
      governor: new PgQuotaGovernor(db, () => defaultPolicy(PRO_PLAN.dailyLimit, 15)),
      plan: new PlanRules(PRO_PLAN),
      fetch: fakeFetch,
    });
    const provider = new ApiSportsProvider(client, { priority: 'LIVE' });
    const store = new PgLiveStore(db);
    const poller = new LivePoller(provider, store, { sport: 'football' });
    const now = new Date();
    const tracked = await store.candidates(
      'football',
      'api-sports',
      new Date(now.getTime() - 3 * 3_600_000),
      now,
    );
    expect(tracked.map((c) => c.eventId)).toEqual([eventId]);

    // o fornecedor passa a devolver o gol
    goals = 1;
    const t0 = Date.now();
    const report = await poller.tick({ now, leagues: [String(LEAGUE)], tracked, finalizeBudget: 0 });
    expect(report).toMatchObject({ outcome: 'ok', calls: 1, events: 1, published: 1 });
    expect(report.changes[0]).toMatchObject({ eventId, goal: true });

    const [score, incident] = await Promise.all([
      sse.waitFor((m) => m.event === 'event.score_changed'),
      sse.waitFor((m) => m.event === 'event.incident_added'),
    ]);
    const latency = Math.max(score.receivedAt, incident.receivedAt) - t0;
    console.log(`ao vivo → SSE: ${latency} ms`);
    expect(latency).toBeLessThanOrEqual(5_000);
    expect(JSON.parse(score.data)).toMatchObject({
      topic: 'event.score_changed',
      event_id: eventId,
      sport: 'football',
      data: { score: { home: 1, away: 0 } },
    });
    expect(JSON.parse(incident.data)).toMatchObject({
      topic: 'event.incident_added',
      event_id: eventId,
      data: { incidents: [{ minute: 15 }] },
    });

    // o sinal interno `live` ficou no change feed (purge/operação), mas não vazou para o SSE
    const live = await db
      .select()
      .from(changeFeed)
      .where(and(eq(changeFeed.topic, 'live'), eq(changeFeed.entityId, eventId)));
    expect(live).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(sse.messages.map((m) => m.event).filter((e) => e !== 'ready')).toEqual(
      expect.not.arrayContaining(['live']),
    );
    expect(sse.messages.filter((m) => m.event === 'event.score_changed')).toHaveLength(1);
    expect(sse.messages.filter((m) => m.event === 'event.incident_added')).toHaveLength(1);

    // novo tick sem mudança: nada novo no stream
    const again = await poller.tick({
      now: new Date(),
      leagues: [String(LEAGUE)],
      tracked,
      finalizeBudget: 0,
    });
    expect(again.published).toBe(0);
    await new Promise((r) => setTimeout(r, 1_200));
    expect(sse.messages.filter((m) => m.event === 'event.score_changed')).toHaveLength(1);
  });
});
