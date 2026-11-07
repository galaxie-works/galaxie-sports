import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TeamStatistics } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  createDb,
  participant,
  runMigrations,
  season,
  sport,
  teamSeasonStat,
  type Database,
} from '@galaxie/db';
import { teamSeasonStatsValues } from '@galaxie/providers';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Estatísticas do time (#893) contra o banco: a escolha da competição e da temporada, a lista do que existe e o
 * `data: null` de quem não tem o dado. Os números vêm do mesmo conversor que o normalizador usa.
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

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TeamStatistics>();
};

const sample = (played: number) =>
  teamSeasonStatsValues({
    league: { id: 1, name: 'x', season: 2026 },
    team: { id: 1, name: 'x' },
    form: 'WWDL',
    fixtures: {
      played: { home: played - 1, away: 1, total: played },
      wins: { home: 2, away: 0, total: 2 },
      draws: { home: 1, away: 0, total: 1 },
      loses: { home: 0, away: 1, total: 1 },
    },
    goals: {
      for: {
        total: { home: 6, away: 0, total: 6 },
        average: { home: '2.0', away: '0.0', total: '1.5' },
        minute: { '0-15': { total: 2 }, '76-90': { total: 4 } },
      },
      against: { total: { home: 1, away: 2, total: 3 } },
    },
    biggest: { wins: { home: '3-0', away: null }, loses: { home: null, away: '2-0' } },
    lineups: [{ formation: '4-3-3', played }],
    cards: { yellow: { '31-45': { total: 3 } }, red: {} },
  });

async function seed() {
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete' } },
  ]);
  const comps = await db
    .insert(competition)
    .values([
      { sport: 'football', slug: 'liga-stats', name: 'Liga Stats', type: 'league' as const },
      { sport: 'football', slug: 'copa-stats', name: 'Copa Stats', type: 'cup' as const },
    ])
    .returning();
  const seasons = await db
    .insert(season)
    .values([
      { competitionId: comps[0]!.id, label: '2025', year: 2025 },
      { competitionId: comps[0]!.id, label: '2026', year: 2026, current: true },
      { competitionId: comps[1]!.id, label: '2026', year: 2026, current: true },
    ])
    .returning();
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club' as const, name: 'Aurora' },
      { sport: 'basketball', kind: 'club' as const, name: 'Cesta' },
    ])
    .returning();
  ids.team = teams[0]!.id;
  ids.basket = teams[1]!.id;
  ids.copa = comps[1]!.id;
  const row = (seasonId: string, played: number, at: string) => {
    const v = sample(played);
    return {
      participantId: ids.team!,
      seasonId,
      ...v,
      stats: v.stats as unknown as Record<string, unknown>,
      observedAt: new Date(at),
    };
  };
  await db
    .insert(teamSeasonStat)
    .values([
      row(seasons[0]!.id, 38, '2025-12-10T00:00:00Z'),
      row(seasons[1]!.id, 30, '2026-11-06T09:00:00Z'),
      row(seasons[2]!.id, 4, '2026-11-05T09:00:00Z'),
    ]);
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  const t = await upsertTenant(db, {
    slug: 'stats-time',
    name: 'Stats',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'stats' })).key;
  app = buildServer({ db, redis, keyPrefix, cdnPurger: new RecordingCdnPurger() });
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

describe('GET /v1/teams/{id}/statistics', () => {
  it('sem filtro: a temporada mais recente, na competição em que o time mais jogou', async () => {
    const body = await get(`/v1/teams/${ids.team}/statistics`);
    expect(body.sport).toBe('football');
    expect(body.data?.competition.slug).toBe('liga-stats');
    expect(body.data?.season).toEqual({ year: 2026, label: '2026' });
    expect(body.data?.record.played).toEqual({ home: 29, away: 1, total: 30 });
    expect(body.data?.form).toBe('LDWW');
    expect(body.data?.goals.scored_average).toEqual({ home: 2, away: 0, total: 1.5 });
    expect(body.data?.goals.scored_by_minute).toEqual([
      { from: 0, to: 15, count: 2 },
      { from: 76, to: 90, count: 4 },
    ]);
    expect(body.data?.biggest.loss.away).toEqual({ for: 0, against: 2 });
    expect(body.data?.cards).toMatchObject({ yellow: 3, red: 0 });
    expect(body.data?.updated_at).toBe('2026-11-06T09:00:00.000Z');
    expect(body.available.map((a) => [a.competition.slug, a.season.year])).toEqual([
      ['liga-stats', 2026],
      ['copa-stats', 2026],
      ['liga-stats', 2025],
    ]);
  });

  it('competição (id ou slug) e temporada escolhem a linha', async () => {
    expect(
      (await get(`/v1/teams/${ids.team}/statistics?competition=${ids.copa}`)).data?.record.played.total,
    ).toBe(4);
    expect(
      (await get(`/v1/teams/${ids.team}/statistics?competition=liga-stats&season=2025`)).data?.season.year,
    ).toBe(2025);
    expect((await get(`/v1/teams/${ids.team}/statistics?season=2024`)).data).toBeNull();
  });

  it('esporte sem o dado: data null e lista vazia; time inexistente: 404', async () => {
    const body = await get(`/v1/teams/${ids.basket}/statistics`);
    expect(body).toMatchObject({ sport: 'basketball', data: null, available: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/teams/0199a5c0-0000-7000-8000-00000000dead/statistics',
      headers: { 'x-galaxie-key': key },
    });
    expect(res.statusCode).toBe(404);
  });
});
