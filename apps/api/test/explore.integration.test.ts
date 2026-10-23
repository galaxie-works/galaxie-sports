import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExploreSummary } from '@galaxie/contracts';
import {
  asset,
  closeDb,
  competition,
  country,
  createDb,
  event,
  eventParticipant,
  participant,
  runMigrations,
  sport,
  teamProfile,
  type Database,
} from '@galaxie/db';
import { loadGeoConfig } from '@galaxie/geo';
import { seedGeo } from '@galaxie/ingestor';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
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
const ASSETS = 'https://assets.test/galaxie';
const NOW = new Date('2026-10-22T12:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let basketballKey: string;
const ids: Record<string, string> = {};

const get = (url: string, k = key) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k } });

async function seed() {
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol', en: 'Football' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete', es: 'Básquetbol', en: 'Basketball' } },
  ]);
  const [flagBr, logoBra, logoLib, crestPal] = await db
    .insert(asset)
    .values([
      { kind: 'flag', sourceUrl: 'https://media.api-sports.io/flags/br.svg', storageKey: 'flags/br.svg' },
      {
        kind: 'league_logo',
        sourceUrl: 'https://media.api-sports.io/football/leagues/71.png',
        storageKey: 'football/leagues/71.png',
      },
      {
        kind: 'league_logo',
        sourceUrl: 'https://media.api-sports.io/football/leagues/13.png',
        storageKey: 'football/leagues/13.png',
      },
      {
        kind: 'team_logo',
        sourceUrl: 'https://media.api-sports.io/football/teams/121.png',
        storageKey: 'football/teams/121.png',
        palette: { version: 1, dominant: '#006437', secondary: null, monochrome: false },
      },
    ])
    .returning();
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil' }, flagAssetId: flagBr!.id },
    { code: 'AR', name: { en: 'Argentina' } },
    { code: 'WORLD', name: { en: 'World' } },
  ]);

  const comps = await db
    .insert(competition)
    .values([
      {
        sport: 'football',
        slug: 'brasileirao-serie-a',
        name: 'Serie A',
        labels: { 'pt-BR': 'Brasileirão Série A' },
        countryCode: 'BR',
        type: 'league',
        tier: 1,
        logoAssetId: logoBra!.id,
      },
      {
        sport: 'football',
        slug: 'copa-do-brasil',
        name: 'Copa Do Brasil',
        countryCode: 'BR',
        type: 'cup',
        tier: 1,
      },
      {
        sport: 'football',
        slug: 'paulista-a1',
        name: 'Paulista - A1',
        countryCode: 'BR',
        type: 'league',
        tier: 1,
      },
      {
        sport: 'football',
        slug: 'brazil-serie-d',
        name: 'Serie D',
        countryCode: 'BR',
        type: 'league',
        tier: 3,
      },
      {
        sport: 'football',
        slug: 'argentina-liga-profesional',
        name: 'Liga Profesional Argentina',
        countryCode: 'AR',
        type: 'league',
        tier: 1,
      },
      {
        sport: 'football',
        slug: 'conmebol-libertadores',
        name: 'CONMEBOL Libertadores',
        labels: { 'pt-BR': 'Libertadores' },
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
        prestige: 10,
        logoAssetId: logoLib!.id,
      },
      {
        sport: 'football',
        slug: 'uefa-euro',
        name: 'Euro Championship',
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
        prestige: 10,
      },
    ])
    .returning();
  for (const c of comps) ids[c.slug] = c.id;

  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras', countryCode: 'BR', logoAssetId: crestPal!.id },
      { sport: 'football', kind: 'club', name: 'Corinthians', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Mirassol', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Boca Juniors', countryCode: 'AR' },
      { sport: 'football', kind: 'club', name: 'River Plate', countryCode: 'AR' },
      { sport: 'football', kind: 'national_team', name: 'Brazil', countryCode: 'BR' },
    ])
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  // Palmeiras está na base semântica (clube grande): vem primeiro mesmo somando menos importância
  await db.insert(teamProfile).values({
    slug: 'palmeiras',
    participantId: ids.Palmeiras!,
    countryCode: 'BR',
    names: { official: 'Sociedade Esportiva Palmeiras' },
    sourceFile: 'football/teams/br.yaml',
  });

  const game = async (
    comp: string,
    home: string,
    away: string,
    startsAt: Date,
    extra: Partial<typeof event.$inferInsert> = {},
  ) => {
    const [e] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: ids[comp]!,
        startsAt,
        endsAtExpected: new Date(startsAt.getTime() + 2 * 3600_000),
        ...extra,
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: e!.id, participantId: ids[home]!, side: 'home' },
      { eventId: e!.id, participantId: ids[away]!, side: 'away' },
    ]);
    return e!.id;
  };

  // passado (ranking dos clubes): Mirassol soma mais importância, mas não tem perfil semântico
  await game('brasileirao-serie-a', 'Mirassol', 'Corinthians', hours(-24 * 30), {
    status: 'finished',
    importance: 80,
  });
  await game('brasileirao-serie-a', 'Mirassol', 'Palmeiras', hours(-24 * 20), {
    status: 'finished',
    importance: 40,
  });
  await game('argentina-liga-profesional', 'Boca Juniors', 'River Plate', hours(-24 * 10), {
    status: 'finished',
    importance: 90,
  });
  // janela: dois do Brasileirão, a Libertadores (BR × AR), um adiado e um fora da janela
  ids.liga = await game('brasileirao-serie-a', 'Corinthians', 'Mirassol', hours(30), { importance: 70 });
  ids.classico = await game('brasileirao-serie-a', 'Palmeiras', 'Corinthians', hours(50), { importance: 70 });
  ids.lib = await game('conmebol-libertadores', 'Palmeiras', 'Boca Juniors', hours(72), { importance: 88 });
  await game('brasileirao-serie-a', 'Mirassol', 'Palmeiras', hours(20), {
    status: 'postponed',
    importance: 99,
  });
  await game('brasileirao-serie-a', 'Corinthians', 'Palmeiras', hours(24 * 9), { importance: 99 });
  // ao vivo agora (dado fresco) e um "ao vivo" velho que /v1/events/live também ignora
  await game('argentina-liga-profesional', 'River Plate', 'Boca Juniors', hours(-1), {
    status: 'live',
    lastValidAt: hours(0),
  });
  await game('paulista-a1', 'Corinthians', 'Mirassol', hours(-48), {
    status: 'live',
    lastValidAt: hours(-47),
  });
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  await seedGeo(db, loadGeoConfig());

  const t = await upsertTenant(db, {
    slug: 'explore',
    name: 'Explore',
    plan: 'core_data',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'explorar' })).key;
  const b = await upsertTenant(db, {
    slug: 'explore-basket',
    name: 'Só basquete',
    plan: 'core_data',
    sports: ['basketball'],
    rateLimitPerMinute: 1000,
  });
  basketballKey = (await createApiKey(db, b.id, { env: 'test', label: 'basquete' })).key;

  app = buildServer({
    db,
    redis,
    keyPrefix,
    assetsBaseUrl: ASSETS,
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

describe('GET /v1/explore/summary', () => {
  it('resume os esportes: catálogo, participantes, próximos, ao vivo e competições em destaque', async () => {
    const res = await get('/v1/explore/summary?locale=pt-BR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('pt-BR');
    expect(res.headers['cache-control']).toContain('s-maxage=60');
    const body = res.json<ExploreSummary>();

    expect(body.window).toEqual({ from: NOW.toISOString(), to: hours(24 * 7).toISOString() });
    expect(body.sports).toHaveLength(12);
    const football = body.sports[0]!;
    expect(football).toMatchObject({
      slug: 'football',
      name: 'Futebol',
      competitions: 6, // tier 1–2 (a Série D, tier 3, fica de fora)
      participants: 6,
      upcoming: 3, // sem o adiado e sem o que está fora da janela
      live: 1, // o "ao vivo" sem dado fresco não conta
    });
    // Euro sem jogos recentes não ocupa a vitrine; Libertadores (prestígio) antes do Brasileirão
    expect(football.top_competitions.map((c) => c.slug)).toEqual([
      'conmebol-libertadores',
      'brasileirao-serie-a',
      'argentina-liga-profesional',
      'paulista-a1',
    ]);
    expect(football.top_competitions[0]).toMatchObject({
      name: 'Libertadores',
      type: 'cup',
      tier: 1,
      logo: `${ASSETS}/football/leagues/13.png`,
    });
    expect(body.sports.find((s) => s.slug === 'basketball')).toMatchObject({
      competitions: 0,
      participants: 0,
      upcoming: 0,
      live: 0,
      top_competitions: [],
    });
  });

  it('resume os países: liga principal, clubes em destaque, jogos e o jogo de maior relevância', async () => {
    const body = (await get('/v1/explore/summary?locale=pt-BR&tz=America/Sao_Paulo')).json<ExploreSummary>();
    expect(body.countries.map((c) => c.code).slice(0, 3)).toEqual(['BR', 'AR', 'BO']);
    expect(body.confederations.map((c) => c.code)).toEqual(['CONMEBOL', 'CONCACAF', 'UEFA']);

    const br = body.countries.find((c) => c.code === 'BR')!;
    expect(br).toMatchObject({
      name: 'Brasil',
      flag: `${ASSETS}/flags/br.svg`,
      confederation: { code: 'CONMEBOL' },
      competitions: 3,
      main_competition: {
        slug: 'brasileirao-serie-a',
        name: 'Brasileirão Série A',
        logo: `${ASSETS}/football/leagues/71.png`,
      },
      upcoming: 3,
      live: 0,
    });
    // perfil semântico primeiro; seleção não entra
    expect(br.top_teams.map((t) => t.name)).toEqual(['Palmeiras', 'Mirassol', 'Corinthians']);
    expect(br.top_teams[0]).toMatchObject({
      logo: `${ASSETS}/football/teams/121.png`,
      colors: { primary: '#006437', monochrome: false },
    });
    // Libertadores: 88 + 10 de bônus do país + 8 de audiência (35 proporcional ao que falta até 100); o
    // clássico do Brasileirão (70) fica em 99: 70 + 10 + 19
    expect(br.highlight).toMatchObject({
      id: ids.lib,
      competition: { slug: 'conmebol-libertadores' },
      relevance: { market: 'BR', score: 100, bonus: 18 },
    });
    expect(br.highlight!.starts_at).toMatch(/-03:00$/);

    const ar = body.countries.find((c) => c.code === 'AR')!;
    expect(ar).toMatchObject({
      upcoming: 1,
      live: 1,
      main_competition: { slug: 'argentina-liga-profesional' },
    });
    expect(ar.highlight).toMatchObject({ id: ids.lib, relevance: { market: 'AR' } });
    expect(ar.top_teams.map((t) => t.name)).toEqual(['Boca Juniors', 'River Plate']);

    const uy = body.countries.find((c) => c.code === 'UY')!;
    expect(uy).toMatchObject({ competitions: 0, main_competition: null, top_teams: [], highlight: null });
  });

  it('respeita os esportes do plano: fora dele, nenhum jogo nem destaque', async () => {
    const body = (await get('/v1/explore/summary', basketballKey)).json<ExploreSummary>();
    expect(body.sports[0]).toMatchObject({ slug: 'football', competitions: 6, upcoming: 0, live: 0 });
    const br = body.countries.find((c) => c.code === 'BR')!;
    expect(br).toMatchObject({ upcoming: 0, live: 0, highlight: null });
  });

  it('exige chave', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/explore/summary' });
    expect(res.statusCode).toBe(401);
  });
});
