import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventOdds, EventPredictions } from '@galaxie/contracts';
import {
  bookmaker,
  closeDb,
  competition,
  createDb,
  event,
  eventOdds,
  eventParticipant,
  eventPrediction,
  participant,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/* Palpite (core_data) e odds (add-on `odds`, fechado até a decisão do dono) de um jogo, contra o banco. */

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
const keys: Record<'basic' | 'odds', string> = { basic: '', odds: '' };
let eventId: string;
let emptyEventId: string;
const teams: Record<string, string> = {};

const call = (url: string, key: string) =>
  app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga-palpites', name: 'Liga Palpites', type: 'league' })
    .returning();
  const clubs = await db
    .insert(participant)
    .values(['Azul', 'Verde'].map((name) => ({ sport: 'football', kind: 'club' as const, name })))
    .returning();
  for (const c of clubs) teams[c.name] = c.id;
  const kickoff = new Date('2026-11-08T22:00:00Z');
  const evs = await db
    .insert(event)
    .values(
      [0, 1].map(() => ({
        sport: 'football',
        competitionId: comp!.id,
        startsAt: kickoff,
        endsAtExpected: new Date(kickoff.getTime() + 7_200_000),
      })),
    )
    .returning();
  eventId = evs[0]!.id;
  emptyEventId = evs[1]!.id;
  for (const e of evs)
    await db.insert(eventParticipant).values([
      { eventId: e.id, participantId: teams.Azul!, side: 'home' },
      { eventId: e.id, participantId: teams.Verde!, side: 'away' },
    ]);
  await db.insert(eventPrediction).values({
    eventId,
    provider: 'api-sports',
    winnerParticipantId: teams.Azul!,
    winOrDraw: true,
    probHome: 45,
    probDraw: 45,
    probAway: 10,
    goals: { total: { side: 'under', line: 3.5 }, home: { side: 'under', line: 2.5 } },
    comparison: { total: { home: 55.7, away: 44.3 }, form: { home: 60, away: 40 } },
    recentForm: {
      home: {
        form: 60,
        attack: 67,
        defense: 40,
        goalsFor: 8,
        goalsAgainst: 5,
        goalsForAverage: 1.6,
        goalsAgainstAverage: 1,
      },
    },
    advice: 'Double chance : Azul or draw',
    winnerComment: 'Win or draw',
    observedAt: new Date('2026-11-07T08:00:00Z'),
  });
  const books = await db
    .insert(bookmaker)
    .values([
      { name: 'Casa Um', slug: 'casa-um' },
      { name: 'Casa Dois', slug: 'casa-dois' },
    ])
    .returning();
  const winner = (home: number, draw: number, away: number) => ({
    key: 'match_winner' as const,
    providerBet: { id: 1, name: 'Match Winner' },
    selections: [
      { key: 'home', line: null, price: home },
      { key: 'draw', line: null, price: draw },
      { key: 'away', line: null, price: away },
    ],
  });
  await db.insert(eventOdds).values([
    {
      eventId,
      bookmakerId: books[0]!.id,
      provider: 'api-sports',
      markets: [
        winner(1.85, 3.4, 4.5),
        {
          key: 'goals_over_under',
          providerBet: { id: 5, name: 'Goals Over/Under' },
          selections: [
            { key: 'over', line: 2.5, price: 2.1 },
            { key: 'under', line: 2.5, price: 1.72 },
          ],
        },
        {
          key: null,
          providerBet: { id: 45, name: 'Corners Over Under' },
          selections: [{ key: 'over', line: 9.5, price: 1.9 }],
        },
      ],
      sourceUpdatedAt: new Date('2026-11-07T07:00:00Z'),
      observedAt: new Date('2026-11-07T08:00:00Z'),
    },
    {
      eventId,
      bookmakerId: books[1]!.id,
      provider: 'api-sports',
      markets: [winner(1.95, 3.3, 4.2)],
      sourceUpdatedAt: new Date('2026-11-07T07:30:00Z'),
      observedAt: new Date('2026-11-07T08:00:00Z'),
    },
  ]);
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  process.env.ODDS_TENANTS = 'com-odds';
  for (const [slug, k] of [
    ['sem-odds', 'basic'],
    ['com-odds', 'odds'],
  ] as const) {
    const t = await upsertTenant(db, { slug, name: slug, plan: 'enterprise', rateLimitPerMinute: 5000 });
    keys[k] = (await createApiKey(db, t.id, { env: 'test', label: slug })).key;
  }
  app = buildServer({ db, redis, keyPrefix, cdnPurger: new RecordingCdnPurger() });
  await app.ready();
}, 60_000);

afterAll(async () => {
  delete process.env.ODDS_TENANTS;
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (found.length) await redis.del(...found);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('GET /v1/events/{id}/predictions', () => {
  it('devolve o palpite com os times pelos nossos IDs e sem o texto livre do fornecedor', async () => {
    const res = await call(`/v1/events/${eventId}/predictions?tz=America/Sao_Paulo`, keys.basic);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<EventPredictions>();
    expect(body.home?.id).toBe(teams.Azul);
    expect(body.away?.id).toBe(teams.Verde);
    expect(body.prediction).toEqual({
      winner: { side: 'home', participant_id: teams.Azul, win_or_draw: true },
      probabilities: { home: 45, draw: 45, away: 10 },
      goals: {
        total: { side: 'under', line: 3.5 },
        home: { side: 'under', line: 2.5 },
        away: null,
      },
      // ordem fixa das chaves, não a do JSON gravado
      comparison: [
        { key: 'form', home: 60, away: 40 },
        { key: 'total', home: 55.7, away: 44.3 },
      ],
      recent_form: {
        home: {
          form: 60,
          attack: 67,
          defense: 40,
          goals_for: 8,
          goals_against: 5,
          goals_for_average: 1.6,
          goals_against_average: 1,
        },
        away: null,
      },
    });
    expect(body.updated_at).toBe('2026-11-07T05:00:00-03:00');
    expect(res.body).not.toContain('Double chance');
  });

  it('jogo sem palpite: prediction null; evento inexistente: 404', async () => {
    const res = await call(`/v1/events/${emptyEventId}/predictions`, keys.basic);
    expect(res.statusCode).toBe(200);
    expect(res.json<EventPredictions>()).toMatchObject({ prediction: null, updated_at: null });
    const missing = await call('/v1/events/0190a4c6-1f5c-7a3e-9a3b-000000000000/predictions', keys.basic);
    expect(missing.statusCode).toBe(404);
  });
});

describe('GET /v1/events/{id}/odds', () => {
  it('fechado: tenant fora de ODDS_TENANTS recebe 403, mesmo no enterprise', async () => {
    const res = await call(`/v1/events/${eventId}/odds`, keys.basic);
    expect(res.statusCode).toBe(403);
  });

  it('consenso por mercado, odds por casa e só os mercados com chave nossa', async () => {
    const res = await call(`/v1/events/${eventId}/odds`, keys.odds);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<EventOdds>();
    expect(body.markets.map((m) => m.key)).toEqual(['match_winner', 'goals_over_under']);
    expect(body.markets[0]!.selections).toEqual([
      { key: 'home', line: null, average: 1.9, best: 1.95, bookmakers: 2 },
      { key: 'draw', line: null, average: 3.35, best: 3.4, bookmakers: 2 },
      { key: 'away', line: null, average: 4.35, best: 4.5, bookmakers: 2 },
    ]);
    expect(body.bookmakers.map((b) => b.name)).toEqual(['Casa Dois', 'Casa Um']);
    expect(body.bookmakers[1]!.markets.map((m) => m.key)).toEqual(['match_winner', 'goals_over_under']);
    expect(body.updated_at).toBe('2026-11-07T07:30:00Z');
    expect(res.body).not.toContain('Corners');
  });

  it('market filtra; mercado desconhecido é 400', async () => {
    const res = await call(`/v1/events/${eventId}/odds?market=goals_over_under`, keys.odds);
    expect(res.json<EventOdds>().markets.map((m) => m.key)).toEqual(['goals_over_under']);
    expect(res.json<EventOdds>().bookmakers.map((b) => b.name)).toEqual(['Casa Um']);
    const bad = await call(`/v1/events/${eventId}/odds?market=corners`, keys.odds);
    expect(bad.statusCode).toBe(400);
  });
});
