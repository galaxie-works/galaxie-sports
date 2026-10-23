import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CountryCompetitions, CountryDetail, Navigation } from '@galaxie/contracts';
import {
  asset,
  closeDb,
  competition,
  competitionProfile,
  country,
  createDb,
  event,
  providerMap,
  runMigrations,
  season,
  sport,
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

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key, ...headers } });

const slugsOf = (body: CountryCompetitions, sportSlug: string, scope: string) =>
  body.sports
    .find((s) => s.sport.slug === sportSlug)
    ?.groups.find((g) => g.scope === scope)
    ?.competitions.map((c) => c.slug) ?? [];

async function seed() {
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol', en: 'Football' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete', es: 'Básquetbol', en: 'Basketball' } },
  ]);
  const [flagBr, logoLib] = await db
    .insert(asset)
    .values([
      { kind: 'flag', sourceUrl: 'https://media.api-sports.io/flags/br.svg', storageKey: 'flags/br.svg' },
      {
        kind: 'league_logo',
        sourceUrl: 'https://media.api-sports.io/football/leagues/13.png',
        storageKey: 'football/leagues/13.png',
      },
    ])
    .returning();
  // como o bootstrap grava: só o en do fornecedor (o geo:seed completa confederação e traduções)
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil' }, flagAssetId: flagBr!.id },
    { code: 'AR', name: { en: 'Argentina' } },
    { code: 'MX', name: { en: 'Mexico' } },
    { code: 'GB-ENG', name: { en: 'England' } },
    { code: 'US', name: { en: 'USA' } },
    { code: 'WORLD', name: { en: 'World', 'pt-BR': 'Mundo', es: 'Mundo' } },
  ]);

  const football = (
    slug: string,
    name: string,
    countryCode: string,
    tier: number,
    type: 'league' | 'cup' = 'cup',
    labels?: Record<string, string>,
  ) => ({ sport: 'football', slug, name, countryCode, tier, type, ...(labels ? { labels } : {}) });
  const comps = await db
    .insert(competition)
    .values([
      football('brasileirao-serie-a', 'Serie A', 'BR', 1, 'league', { 'pt-BR': 'Brasileirão Série A' }),
      football('copa-do-brasil', 'Copa Do Brasil', 'BR', 1),
      football('paulista-a1', 'Paulista - A1', 'BR', 1, 'league', { 'pt-BR': 'Paulistão' }),
      football('carioca', 'Carioca - 1', 'BR', 1, 'league', { 'pt-BR': 'Campeonato Carioca' }),
      football('brasileirao-serie-b', 'Serie B', 'BR', 2, 'league'),
      football('brazil-paulista-a2-476', 'Paulista - A2', 'BR', 3, 'league'),
      football('argentina-liga-profesional', 'Liga Profesional Argentina', 'AR', 1, 'league'),
      football('liga-mx', 'Liga MX', 'MX', 1, 'league'),
      football('premier-league', 'Premier League', 'GB-ENG', 1, 'league'),
      football('conmebol-libertadores', 'CONMEBOL Libertadores', 'WORLD', 1, 'cup', {
        'pt-BR': 'Copa Libertadores',
        es: 'Copa Libertadores',
      }),
      football('conmebol-sudamericana', 'CONMEBOL Sudamericana', 'WORLD', 1, 'cup', {
        'pt-BR': 'Copa Sul-Americana',
        es: 'Copa Sudamericana',
      }),
      football('conmebol-recopa', 'CONMEBOL Recopa', 'WORLD', 1),
      football('uefa-champions-league', 'UEFA Champions League', 'WORLD', 1),
      football('leagues-cup', 'Leagues Cup', 'WORLD', 2),
      football('concacaf-champions-cup', 'CONCACAF Champions League', 'WORLD', 2),
      football('fifa-world-cup', 'World Cup', 'WORLD', 1),
      football('wc-qualification-conmebol', 'World Cup - Qualification South America', 'WORLD', 1),
      football('copa-america', 'Copa America', 'WORLD', 1),
      football('fifa-club-world-cup', 'FIFA Club World Cup', 'WORLD', 1),
      football('club-friendlies', 'Friendlies Clubs', 'WORLD', 2),
      // fora do catálogo: o slug gerado mudou, o casamento é pelo ID da api-sports (1168)
      football('world-fifa-intercontinental-cup-renamed-1168', 'FIFA Intercontinental Cup', 'WORLD', 3),
      { sport: 'basketball', slug: 'nbb', name: 'NBB', countryCode: 'BR', type: 'league', tier: 1 },
      {
        sport: 'basketball',
        slug: 'fiba-americup',
        name: 'FIBA AmeriCup',
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
      },
      {
        sport: 'basketball',
        slug: 'euroleague',
        name: 'Euroleague',
        countryCode: 'WORLD',
        type: 'cup',
        tier: 2,
      },
    ])
    .returning();
  const id = Object.fromEntries(comps.map((c) => [`${c.sport}/${c.slug}`, c.id]));
  await db
    .update(competition)
    .set({ logoAssetId: logoLib!.id })
    .where(eq(competition.id, id['football/conmebol-libertadores']!));
  await db.insert(providerMap).values({
    entityType: 'competition',
    entityId: id['football/world-fifa-intercontinental-cup-renamed-1168']!,
    provider: 'api-sports',
    sport: 'football',
    providerId: '1168',
  });
  await db.insert(competitionProfile).values({
    slug: 'libertadores',
    competitionId: id['football/conmebol-libertadores']!,
    labels: { 'pt-BR': 'Libertadores' },
    nicknames: { 'pt-BR': ['Glória Eterna'], es: ['La Gloria Eterna'] },
    sourceFile: 'competitions/football.yaml',
  });
  await db.insert(season).values([
    { competitionId: id['football/conmebol-libertadores']!, label: '2026', year: 2026, current: true },
    { competitionId: id['football/conmebol-libertadores']!, label: '2025', year: 2025 },
    { competitionId: id['football/brasileirao-serie-a']!, label: '2026', year: 2026, current: true },
  ]);
  const at = new Date('2026-10-21T22:00:00Z');
  await db.insert(event).values(
    [1, 2, 3].map((h) => ({
      sport: 'football',
      competitionId: id['football/brasileirao-serie-a']!,
      startsAt: new Date(at.getTime() + h * 3600_000),
      endsAtExpected: new Date(at.getTime() + (h + 2) * 3600_000),
    })),
  );
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  await seedGeo(db, loadGeoConfig());

  const t = await upsertTenant(db, { slug: 'nav', name: 'Nav', plan: 'core_data', rateLimitPerMinute: 1000 });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'navegação' })).key;

  app = buildServer({
    db,
    redis,
    keyPrefix,
    assetsBaseUrl: ASSETS,
    cdnPurger: new RecordingCdnPurger(),
    changeFeed: { pollIntervalMs: 250 },
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

describe('GET /v1/navigation', () => {
  it('devolve os 12 esportes (futebol primeiro, contagens e has_data) e os 17 países com bandeira', async () => {
    const res = await get('/v1/navigation?locale=pt-BR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('pt-BR');
    expect(res.headers['cache-control']).toContain('s-maxage=86400');
    const body = res.json<Navigation>();

    expect(body.sports).toHaveLength(12);
    expect(body.sports[0]).toEqual({
      slug: 'football',
      name: 'Futebol',
      competitions: 21,
      events: 3,
      has_data: true,
      mirror: '/mirror/football',
    });
    expect(body.sports.find((s) => s.slug === 'basketball')).toMatchObject({
      competitions: 3,
      events: 0,
      has_data: true,
    });
    // esporte sem nada no banco: nome do config/geo, has_data false
    expect(body.sports.find((s) => s.slug === 'volleyball')).toMatchObject({
      name: 'Vôlei',
      competitions: 0,
      has_data: false,
    });

    expect(body.countries.map((c) => c.code)).toEqual([
      'BR',
      'AR',
      'BO',
      'CL',
      'CO',
      'EC',
      'PY',
      'PE',
      'UY',
      'VE',
      'MX',
      'GB-ENG',
      'ES',
      'IT',
      'DE',
      'FR',
      'PT',
    ]);
    expect(body.countries[0]).toEqual({
      code: 'BR',
      name: 'Brasil',
      flag: `${ASSETS}/flags/br.svg`,
      confederation: { code: 'CONMEBOL', name: 'CONMEBOL (América do Sul)' },
    });
    expect(body.countries.find((c) => c.code === 'GB-ENG')).toMatchObject({ name: 'Inglaterra', flag: null });
    expect(body.confederations.map((c) => [c.code, c.countries.length])).toEqual([
      ['CONMEBOL', 10],
      ['CONCACAF', 1],
      ['UEFA', 6],
    ]);
  });

  it('localiza em espanhol (es-AR → es)', async () => {
    const body = (await get('/v1/navigation', { 'accept-language': 'es-AR' })).json<Navigation>();
    expect(body.sports[0]!.name).toBe('Fútbol');
    expect(body.countries.find((c) => c.code === 'GB-ENG')!.name).toBe('Inglaterra');
    expect(body.countries.find((c) => c.code === 'DE')!.name).toBe('Alemania');
    expect(body.confederations[0]!.name).toBe('CONMEBOL (Sudamérica)');
  });
});

describe('GET /v1/countries/{code}', () => {
  it('país com confederação, bandeira e código COI', async () => {
    const res = await get('/v1/countries/br?locale=es-MX');
    expect(res.statusCode).toBe(200);
    expect(res.json<CountryDetail>()).toEqual({
      code: 'BR',
      name: 'Brasil',
      ioc_code: 'BRA',
      flag: `${ASSETS}/flags/br.svg`,
      confederation: { code: 'CONMEBOL', name: 'CONMEBOL (Sudamérica)' },
      in_navigation: true,
    });
  });

  it('país da navegação ainda sem linha no catálogo vem do config/geo; fora de tudo → 404; inválido → 400', async () => {
    expect((await get('/v1/countries/GB-ENG')).json<CountryDetail>()).toMatchObject({
      name: 'Inglaterra',
      confederation: { code: 'UEFA' },
      in_navigation: true,
    });
    expect((await get('/v1/countries/US')).json<CountryDetail>()).toMatchObject({
      name: 'Estados Unidos',
      confederation: { code: 'CONCACAF' },
      in_navigation: false,
    });
    const missing = await get('/v1/countries/ZZ');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect((await get('/v1/countries/brasil')).statusCode).toBe(400);
  });
});

describe('GET /v1/countries/{code}/competitions', () => {
  it('Brasil: nacionais em destaque, Libertadores/Sul-Americana/Recopa, seleção, mundiais e estaduais', async () => {
    const res = await get('/v1/countries/BR/competitions?locale=pt-BR');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage=86400');
    const body = res.json<CountryCompetitions>();
    expect(body.country).toMatchObject({ code: 'BR', confederation: { code: 'CONMEBOL' } });
    expect(body.sports.map((s) => s.sport)).toEqual([
      { slug: 'football', name: 'Futebol' },
      { slug: 'basketball', name: 'Basquete' },
    ]);
    const football = body.sports[0]!;
    expect(football.groups.map((g) => [g.scope, g.label])).toEqual([
      ['domestic', 'Competições nacionais'],
      ['continental_clubs', 'Copas continentais de clubes'],
      ['national_teams', 'Seleção'],
      ['world_clubs', 'Mundiais de clubes'],
      ['regional', 'Estaduais e regionais'],
    ]);
    // nacionais: as divisões em ordem e depois as copas (`featured`, antes do tier); estaduais num grupo
    // próprio, na ordem da lista `regional` (Paulista antes do Carioca); tier 3 fica de fora
    expect(slugsOf(body, 'football', 'domestic')).toEqual([
      'brasileirao-serie-a',
      'brasileirao-serie-b',
      'copa-do-brasil',
    ]);
    expect(slugsOf(body, 'football', 'regional')).toEqual(['paulista-a1', 'carioca']);
    expect(slugsOf(body, 'football', 'continental_clubs')).toEqual([
      'conmebol-libertadores',
      'conmebol-sudamericana',
      'conmebol-recopa',
    ]);
    expect(slugsOf(body, 'football', 'national_teams')).toEqual([
      'fifa-world-cup',
      'wc-qualification-conmebol',
      'copa-america',
    ]);
    expect(slugsOf(body, 'football', 'world_clubs')).toEqual([
      'fifa-club-world-cup',
      'world-fifa-intercontinental-cup-renamed-1168',
    ]);

    const lib = football.groups[1]!.competitions[0]!;
    expect(lib).toMatchObject({
      name: 'Libertadores',
      official_name: 'CONMEBOL Libertadores',
      nicknames: ['Glória Eterna'],
      tier: 1,
      scope: 'continental_clubs',
      confederations: ['CONMEBOL'],
      country: { code: 'WORLD', name: 'Mundo' },
      logo: `${ASSETS}/football/leagues/13.png`,
      current_season: { year: 2026, label: '2026' },
    });
    expect(football.groups[0]!.competitions[0]).toMatchObject({
      name: 'Brasileirão Série A',
      scope: 'domestic',
      level: 'national',
      confederations: [],
      country: { code: 'BR', name: 'Brasil' },
    });
    expect(football.groups[4]!.competitions[0]).toMatchObject({ scope: 'regional', level: 'regional' });
    expect(lib.level).toBeNull();
    expect(slugsOf(body, 'basketball', 'domestic')).toEqual(['nbb']);
    expect(slugsOf(body, 'basketball', 'national_teams')).toEqual(['fiba-americup']);
    expect(slugsOf(body, 'basketball', 'continental_clubs')).toEqual([]);
  });

  it('Argentina divide com o Brasil as copas da CONMEBOL; ?sport filtra', async () => {
    const body = (
      await get('/v1/countries/AR/competitions?sport=football&locale=es-AR')
    ).json<CountryCompetitions>();
    expect(body.sports).toHaveLength(1);
    expect(slugsOf(body, 'football', 'domestic')).toEqual(['argentina-liga-profesional']);
    expect(slugsOf(body, 'football', 'continental_clubs')).toEqual([
      'conmebol-libertadores',
      'conmebol-sudamericana',
      'conmebol-recopa',
    ]);
    const sula = body.sports[0]!.groups[1]!.competitions[1]!;
    expect(sula.name).toBe('Copa Sudamericana');
    expect(body.sports[0]!.groups[1]!.label).toBe('Copas continentales de clubes');
  });

  it('México: CONCACAF, Leagues Cup e Copa América (convidado); Inglaterra: Champions', async () => {
    const mx = (await get('/v1/countries/MX/competitions?sport=football')).json<CountryCompetitions>();
    expect(slugsOf(mx, 'football', 'continental_clubs')).toEqual(['concacaf-champions-cup', 'leagues-cup']);
    expect(slugsOf(mx, 'football', 'national_teams')).toEqual(['fifa-world-cup', 'copa-america']);
    expect(mx.sports[0]!.groups[1]!.competitions[1]!.confederations).toEqual([]);

    const eng = (await get('/v1/countries/gb-eng/competitions')).json<CountryCompetitions>();
    expect(eng.country.name).toBe('Inglaterra');
    expect(slugsOf(eng, 'football', 'domestic')).toEqual(['premier-league']);
    expect(slugsOf(eng, 'football', 'continental_clubs')).toEqual(['uefa-champions-league']);
    expect(slugsOf(eng, 'football', 'national_teams')).toEqual(['fifa-world-cup']);
    expect(slugsOf(eng, 'basketball', 'continental_clubs')).toEqual(['euroleague']);
  });

  it('max_tier=3 inclui o restante do espelho; país inexistente → 404; max_tier inválido → 400', async () => {
    const all = (
      await get('/v1/countries/BR/competitions?sport=football&max_tier=3')
    ).json<CountryCompetitions>();
    expect(slugsOf(all, 'football', 'domestic')).toContain('brazil-paulista-a2-476');
    expect((await get('/v1/countries/ZZ/competitions')).statusCode).toBe(404);
    expect((await get('/v1/countries/BR/competitions?max_tier=9')).statusCode).toBe(400);
  });

  it('serve do cache na segunda chamada', async () => {
    await get('/v1/countries/PE/competitions');
    const again = await get('/v1/countries/PE/competitions');
    expect(again.headers['x-galaxie-cache']).toBe('HIT');
    // Peru ainda sem competições domésticas no banco: só as internacionais da CONMEBOL
    expect(slugsOf(again.json<CountryCompetitions>(), 'football', 'domestic')).toEqual([]);
    expect(slugsOf(again.json<CountryCompetitions>(), 'football', 'continental_clubs')).toHaveLength(3);
  });
});
