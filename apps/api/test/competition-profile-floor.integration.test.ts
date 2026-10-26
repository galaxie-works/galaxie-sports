import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Competition, CompetitionSummary, Event, SearchResponse } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  competitionProfile,
  country,
  createDb,
  event,
  participant,
  eventParticipant,
  runMigrations,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Piso editorial do perfil da competição (competitions/profile.ts): rótulo, apelidos e troféu de
 * `semantic.competition_profile` só saem quando o perfil atinge o piso do servidor
 * (SEMANTIC_MIN_REVIEW_STATUS). Abaixo dele, vale o rótulo do catálogo e não há apelido nem troféu.
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
const NOW = new Date('2026-10-22T18:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
/** Piso padrão (approved), o da produção pelo compose. */
let strict: FastifyInstance;
/** Piso draft (desenvolvimento local, ou a VPS se configurada assim). */
let lenient: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = async <T>(server: FastifyInstance, url: string) => {
  const res = await server.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values([
    { code: 'WORLD', name: { en: 'World', 'pt-BR': 'Mundo', es: 'Mundo' } },
    { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil', es: 'Brasil' } },
    { code: 'AR', name: { en: 'Argentina', 'pt-BR': 'Argentina', es: 'Argentina' } },
  ]);
  const comps = await db
    .insert(competition)
    .values([
      {
        sport: 'football',
        slug: 'conmebol-libertadores',
        name: 'CONMEBOL Libertadores',
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
        labels: { 'pt-BR': 'Copa Libertadores da América' },
      },
      {
        sport: 'football',
        slug: 'uefa-champions-league',
        name: 'UEFA Champions League',
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
        labels: { 'pt-BR': 'Liga dos Campeões da UEFA', es: 'UEFA Champions League' },
      },
    ])
    .returning();
  for (const c of comps) ids[c.slug] = c.id;
  await db.insert(competitionProfile).values([
    {
      slug: 'libertadores',
      competitionId: ids['conmebol-libertadores']!,
      labels: { 'pt-BR': 'Libertadores' },
      nicknames: { 'pt-BR': ['Glória Eterna'] },
      sourceFile: 'competitions/football.yaml',
      reviewStatus: 'approved',
    },
    {
      // rascunho: só vale no piso draft
      slug: 'uefa-champions-league',
      competitionId: ids['uefa-champions-league']!,
      labels: { 'pt-BR': 'Liga dos Campeões', es: 'Champions' },
      nicknames: { 'pt-BR': ['Orelhuda'], es: ['La Orejona'] },
      trophyNickname: 'Orelhuda',
      sourceFile: 'competitions/football-europe-world.yaml',
      reviewStatus: 'draft',
    },
  ]);
  await db
    .insert(season)
    .values(comps.map((c) => ({ competitionId: c.id, label: '2026', year: 2026, current: true })));
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Boca Juniors', countryCode: 'AR' },
    ])
    .returning();
  const games = await db
    .insert(event)
    .values(
      comps.map((c, i) => ({
        sport: 'football',
        competitionId: c.id,
        startsAt: hours(24 + i),
        endsAtExpected: hours(26 + i),
        status: 'scheduled' as const,
      })),
    )
    .returning();
  for (const g of games) ids[`event:${g.competitionId}`] = g.id;
  await db.insert(eventParticipant).values(
    games.flatMap((g) => [
      { eventId: g.id, participantId: teams[0]!.id, side: 'home' as const },
      { eventId: g.id, participantId: teams[1]!.id, side: 'away' as const },
    ]),
  );
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  const t = await upsertTenant(db, {
    slug: 'piso-competicao',
    name: 'Piso da competição',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'piso' })).key;
  const base = { db, redis, cdnPurger: new RecordingCdnPurger(), now: () => NOW };
  strict = buildServer({ ...base, keyPrefix });
  lenient = buildServer({ ...base, keyPrefix: `${keyPrefix}draft:`, semantic: { minReviewStatus: 'draft' } });
  await Promise.all([strict.ready(), lenient.ready()]);
}, 60_000);

afterAll(async () => {
  await strict?.close();
  await lenient?.close();
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

describe('perfil da competição × piso editorial', () => {
  it('detalhe: perfil em rascunho não serve rótulo, apelidos nem troféu no piso approved', async () => {
    const c = await get<Competition>(strict, '/v1/competitions/uefa-champions-league?locale=pt-BR');
    expect(c).toMatchObject({ name: 'Liga dos Campeões da UEFA', nicknames: [], trophy_nickname: null });
    const draft = await get<Competition>(lenient, '/v1/competitions/uefa-champions-league?locale=pt-BR');
    expect(draft).toMatchObject({
      name: 'Liga dos Campeões',
      nicknames: ['Orelhuda'],
      trophy_nickname: 'Orelhuda',
    });
  });

  it('perfil aprovado continua servido nos dois pisos', async () => {
    for (const server of [strict, lenient]) {
      const c = await get<Competition>(server, '/v1/competitions/conmebol-libertadores?locale=pt-BR');
      expect(c).toMatchObject({ name: 'Libertadores', nicknames: ['Glória Eterna'] });
    }
  });

  it('lista com q: o apelido de perfil em rascunho não casa no piso approved', async () => {
    const strictList = await get<{ data: CompetitionSummary[] }>(strict, '/v1/competitions?q=orelhuda');
    expect(strictList.data).toEqual([]);
    const draftList = await get<{ data: CompetitionSummary[] }>(lenient, '/v1/competitions?q=orelhuda');
    expect(draftList.data.map((c) => c.slug)).toEqual(['uefa-champions-league']);
  });

  it('busca: apelidos e troféu do rascunho ficam de fora no piso approved', async () => {
    const strictHits = await get<SearchResponse>(strict, '/v1/search?q=orelhuda&types=competition');
    expect(strictHits.data).toEqual([]);
    const draftHits = await get<SearchResponse>(lenient, '/v1/search?q=orelhuda&types=competition');
    expect(draftHits.data.map((h) => h.id)).toEqual([ids['uefa-champions-league']]);
  });

  it('evento: nome e apelido da competição seguem o piso', async () => {
    const ucl = ids[`event:${ids['uefa-champions-league']}`]!;
    const lib = ids[`event:${ids['conmebol-libertadores']}`]!;
    const strictUcl = await get<Event>(strict, `/v1/events/${ucl}?locale=pt-BR`);
    expect(strictUcl.competition).toMatchObject({ name: 'Liga dos Campeões da UEFA', nickname: null });
    const draftUcl = await get<Event>(lenient, `/v1/events/${ucl}?locale=pt-BR`);
    expect(draftUcl.competition).toMatchObject({ name: 'Liga dos Campeões', nickname: 'Orelhuda' });
    const strictLib = await get<Event>(strict, `/v1/events/${lib}?locale=pt-BR`);
    expect(strictLib.competition).toMatchObject({ name: 'Libertadores', nickname: 'Glória Eterna' });
  });

  it('aprovação no painel (status gravado no perfil) passa a valer no piso approved', async () => {
    // o painel grava o status direto em semantic.competition_profile (e o seed o reaplica a cada carga)
    await db
      .update(competitionProfile)
      .set({ reviewStatus: 'approved' })
      .where(eq(competitionProfile.slug, 'uefa-champions-league'));
    // outro locale: resposta ainda fora do cache
    const c = await get<Competition>(strict, '/v1/competitions/uefa-champions-league?locale=es-AR');
    expect(c).toMatchObject({ name: 'Champions', nicknames: ['La Orejona'], trophy_nickname: 'Orelhuda' });
  });
});
