import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Event, ExploreSummary, SearchResponse, TeamOverview } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  createDb,
  participant,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { loadGeoConfig } from '@galaxie/geo';
import { parseProvisionalFile, seedGeo, syncProvisionalFixtures, upsertBatch } from '@galaxie/ingestor';
import { normalizeFixtures, type ApiFixture } from '@galaxie/providers';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Jogo provisório nas rotas /v1: anunciado pela curadoria (provisional:sync) antes do fornecedor, ele
 * aparece como qualquer jogo (evento, competição, time, Explorar e busca) com `provisional` preenchido; o
 * jogo oficial assume o mesmo `id` e o campo passa a null.
 */

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
const NOW = new Date('2026-10-23T12:00:00Z');

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let finalId: string;
const teamIds: Record<string, string> = {};

const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

const TEAMS: Record<number, string> = { 121: 'Palmeiras', 124: 'Fluminense', 450: 'Estudiantes L.P.' };
const CENTENARIO = { id: 1624, name: 'Estadio Centenario', city: 'Montevideo' };

function fixture(id: number, round: string, home: number, away: number, kickoff: string): ApiFixture {
  const side = (t: number) => ({ id: t, name: TEAMS[t]!, logo: null, winner: null });
  return {
    fixture: {
      id,
      referee: null,
      timezone: 'UTC',
      date: kickoff,
      timestamp: Date.parse(kickoff) / 1000,
      venue: CENTENARIO,
      status: { long: 'Not Started', short: 'NS', elapsed: null },
    },
    league: {
      id: 13,
      name: 'CONMEBOL Libertadores',
      country: 'World',
      logo: null,
      flag: null,
      season: 2026,
      round,
    },
    teams: { home: side(home), away: side(away) },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

const final = parseProvisionalFile({
  schema_version: 1,
  fixtures: [
    {
      key: 'football-conmebol-libertadores-2026-final',
      sport: 'football',
      competition: 'conmebol-libertadores',
      season: 2026,
      stage: 'Final',
      home: { team: 121, name: 'Palmeiras' },
      away: { team: 450, name: 'Estudiantes L.P.' },
      date: '2026-11-28',
      time: null,
      timezone: 'America/Montevideo',
      venue: CENTENARIO,
      announced_by: 'Conmebol',
      status: 'announced',
      sources: [{ name: 'Conmebol', url: 'https://gol.conmebol.com/libertadores', checked_at: '2026-10-23' }],
      note: { 'pt-BR': 'Jogo único.', es: 'Partido único.', en: 'Single match.' },
    },
  ],
});

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol', en: 'Football' } });
  await seedGeo(db, loadGeoConfig());

  // times e estádio chegam pelo fornecedor (provider_map); a curadoria só cita os IDs dele
  await upsertBatch(
    db,
    normalizeFixtures(
      [fixture(2001, 'Semi-finals', 124, 121, '2026-10-15T00:30:00Z')],
      new Date('2026-10-15T03:00:00Z'),
    ),
  );
  await upsertBatch(
    db,
    normalizeFixtures(
      [fixture(2002, 'Semi-finals', 450, 124, '2026-10-16T00:30:00Z')],
      new Date('2026-10-16T03:00:00Z'),
    ),
  );
  await db
    .update(competition)
    .set({ slug: 'conmebol-libertadores', tier: 1, prestige: 10, labels: { 'pt-BR': 'Copa Libertadores' } })
    .where(eq(competition.sport, 'football'));
  for (const [name, code] of [
    ['Palmeiras', 'BR'],
    ['Estudiantes L.P.', 'AR'],
    ['Fluminense', 'BR'],
  ] as const) {
    const [p] = await db
      .update(participant)
      .set({ countryCode: code })
      .where(eq(participant.name, name))
      .returning();
    teamIds[name] = p!.id;
  }
  const [r] = await syncProvisionalFixtures(db, final, { now: NOW });
  finalId = r!.eventId!;

  const t = await upsertTenant(db, {
    slug: 'prov',
    name: 'Prov',
    plan: 'core_data',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'provisorio' })).key;
  app = buildServer({
    db,
    redis,
    keyPrefix,
    cdnPurger: new RecordingCdnPurger(),
    changeFeed: { pollIntervalMs: 250 },
    now: () => NOW,
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
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('jogo provisório nas rotas /v1', () => {
  it('GET /v1/events/{id}: diz que é provisório, com quem anunciou, fontes e horário a confirmar', async () => {
    const res = await get(`/v1/events/${finalId}?locale=pt-BR&tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    const e = res.json<Event>();
    expect(e).toMatchObject({
      id: finalId,
      status: 'scheduled',
      status_detail: 'TBD',
      starts_at: '2026-11-28T12:00:00-03:00',
      stage: { kind: 'final', name: 'Final' },
      competition: { slug: 'conmebol-libertadores', name: 'Copa Libertadores' },
      venue: { name: 'Estadio Centenario', city: 'Montevideo' },
      competition_context: expect.arrayContaining(['final']),
      provisional: {
        announced_by: 'Conmebol',
        time_confirmed: false,
        note: 'Jogo único.',
        sources: [
          { name: 'Conmebol', url: 'https://gol.conmebol.com/libertadores', checked_at: '2026-10-23' },
        ],
      },
    });
    expect(e.participants.map((p) => [p.side, p.name])).toEqual([
      ['home', 'Palmeiras'],
      ['away', 'Estudiantes L.P.'],
    ]);
    expect(e.importance).toBeGreaterThan(60);
    // relevância por país: time do mercado e competição continental
    expect(e.relevance_by_market?.find((r) => r.market === 'BR')?.reasons).toEqual(
      expect.arrayContaining(['team_from_market', 'continental_competition']),
    );
    const es = (await get(`/v1/events/${finalId}?locale=es-AR`)).json<Event>();
    expect(es.provisional?.note).toBe('Partido único.');
  });

  it('aparece na competição, no time (próximo jogo), no Explorar e na busca', async () => {
    const list = (
      await get('/v1/events?competition=conmebol-libertadores&from=2026-11-01&to=2026-11-30')
    ).json<{ data: Event[] }>().data;
    expect(list.map((e) => [e.id, e.provisional?.time_confirmed])).toEqual([[finalId, false]]);

    const team = (await get(`/v1/teams/${teamIds['Estudiantes L.P.']}/overview`)).json<TeamOverview>();
    expect(team.next_event).toMatchObject({ id: finalId, provisional: { announced_by: 'Conmebol' } });

    const summary = (await get('/v1/explore/summary?locale=pt-BR')).json<ExploreSummary>();
    const br = summary.countries.find((c) => c.code === 'BR')!;
    const ar = summary.countries.find((c) => c.code === 'AR')!;
    expect(br.announced.map((e) => e.id)).toEqual([finalId]);
    expect(br.announced[0]).toMatchObject({
      provisional: { time_confirmed: false },
      relevance: { market: 'BR' },
    });
    expect(ar.announced.map((e) => e.id)).toEqual([finalId]);
    expect(summary.countries.find((c) => c.code === 'CL')!.announced).toEqual([]);

    const search = (await get('/v1/search?q=estudiantes&types=event')).json<SearchResponse>();
    expect(search.data).toEqual([
      expect.objectContaining({
        type: 'event',
        id: finalId,
        event: expect.objectContaining({ provisional: true }),
      }),
    ]);
  });

  it('o fornecedor publica a final: mesmo id, provisional null', async () => {
    const stats = await upsertBatch(
      db,
      normalizeFixtures(
        [fixture(2003, 'Final', 121, 450, '2026-11-28T20:00:00Z')],
        new Date('2026-11-01T10:00:00Z'),
      ),
    );
    expect(stats.events.provisionalMerged).toBe(1);
    // outra variação do cache (o purge pelo change feed é assíncrono)
    const e = (await get(`/v1/events/${finalId}?locale=es-UY`)).json<Event>();
    expect(e).toMatchObject({
      id: finalId,
      status_detail: 'NS',
      starts_at: '2026-11-28T20:00:00Z',
      provisional: null,
    });
  });
});
