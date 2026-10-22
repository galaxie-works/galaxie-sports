import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestHash } from '@galaxie/apisports-client';
import {
  apiKey,
  apiResponse,
  asset,
  backfillRequest,
  closeDb,
  competition,
  competitionProfile,
  country,
  createDb,
  participant,
  providerMap,
  publishChange,
  runMigrations,
  season,
  sport,
  standing,
  venue,
  type Database,
} from '@galaxie/db';
import { createApiKey, revokeApiKey, upsertTenant } from '../src/auth/admin.js';
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
const cdn = new RecordingCdnPurger();
const ids: Record<string, string> = {};

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key, ...headers } });

async function seed() {
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol', en: 'Football' } },
    { slug: 'basketball', name: { 'pt-BR': 'Basquete', es: 'Básquetbol', en: 'Basketball' } },
  ]);
  const [flagBr, flagAr, logo, stadium] = await db
    .insert(asset)
    .values([
      { kind: 'flag', sourceUrl: 'https://media.api-sports.io/flags/br.svg', storageKey: 'flags/br.svg' },
      { kind: 'flag', sourceUrl: 'https://media.api-sports.io/flags/ar.svg' },
      {
        kind: 'league_logo',
        sourceUrl: 'https://media.api-sports.io/football/leagues/71.png',
        storageKey: 'football/leagues/71.png',
      },
      { kind: 'venue', sourceUrl: 'https://media.api-sports.io/football/venues/1.png' },
    ])
    .returning();
  await db.insert(country).values([
    {
      code: 'BR',
      name: { en: 'Brazil', 'pt-BR': 'Brasil' },
      iocCode: 'BRA',
      confederation: 'CONMEBOL',
      flagAssetId: flagBr!.id,
    },
    { code: 'AR', name: { en: 'Argentina' }, flagAssetId: flagAr!.id },
    { code: 'WORLD', name: { en: 'World', 'pt-BR': 'Mundo', es: 'Mundo' } },
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
        logoAssetId: logo!.id,
      },
      {
        sport: 'football',
        slug: 'libertadores',
        name: 'CONMEBOL Libertadores',
        labels: { 'pt-BR': 'Libertadores', es: 'Libertadores' },
        countryCode: 'WORLD',
        type: 'cup',
        tier: 1,
      },
      {
        sport: 'football',
        slug: 'liga-profesional',
        name: 'Liga Profesional Argentina',
        countryCode: 'AR',
        type: 'league',
        tier: 1,
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        sport: 'football',
        slug: `liga-x-${i}`,
        name: `Liga X ${i}`,
        countryCode: 'AR',
        type: 'league' as const,
        tier: 3,
      })),
      { sport: 'basketball', slug: 'nbb', name: 'NBB', countryCode: 'BR', type: 'league', tier: 2 },
    ])
    .returning();
  for (const c of comps) ids[c.slug] = c.id;

  await db.insert(competitionProfile).values({
    slug: 'libertadores',
    competitionId: ids.libertadores!,
    labels: { 'pt-BR': 'Libertadores', es: 'Libertadores', en: 'Copa Libertadores' },
    nicknames: { 'pt-BR': ['Glória Eterna', 'Liberta'], es: ['La Gloria Eterna'] },
    trophyNickname: null,
    sourceFile: 'competitions/football.yaml',
  });
  await db.insert(providerMap).values({
    entityType: 'competition',
    entityId: ids['brasileirao-serie-a']!,
    provider: 'api-sports',
    sport: 'football',
    providerId: '71',
  });
  const seasons = await db
    .insert(season)
    .values([
      {
        competitionId: ids['brasileirao-serie-a']!,
        label: '2024',
        year: 2024,
        startDate: '2024-04-13',
        endDate: '2024-12-08',
      },
      { competitionId: ids['brasileirao-serie-a']!, label: '2025', year: 2025 },
      { competitionId: ids['brasileirao-serie-a']!, label: '2026', year: 2026, current: true },
    ])
    .returning();
  ids.season2024 = seasons[0]!.id;

  const [palmeiras, botafogo] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras', shortName: 'PAL', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Botafogo', countryCode: 'BR' },
    ])
    .returning();
  await db.insert(standing).values([
    {
      seasonId: ids.season2024!,
      participantId: botafogo!.id,
      rank: 1,
      points: 79,
      played: 38,
      won: 23,
      drawn: 10,
      lost: 5,
      goalsFor: 59,
      goalsAgainst: 29,
      form: 'WWDWW',
      description: 'Promotion - CONMEBOL Libertadores',
    },
    {
      seasonId: ids.season2024!,
      participantId: palmeiras!.id,
      rank: 2,
      points: 73,
      played: 38,
      won: 22,
      drawn: 7,
      lost: 9,
      goalsFor: 60,
      goalsAgainst: 33,
    },
  ]);
  await db
    .update(standing)
    .set({ updatedAt: new Date('2024-12-09T03:00:00Z') })
    .where(eq(standing.seasonId, ids.season2024!));

  const [v] = await db
    .insert(venue)
    .values({
      name: 'Allianz Parque',
      city: 'São Paulo',
      countryCode: 'BR',
      capacity: 43713,
      surface: 'artificial turf',
      imageAssetId: stadium!.id,
      // reconciliação da base semântica: o fornecedor ainda diz "Allianz Parque"
      curated: {
        name: 'Nubank Parque',
        city: 'São Paulo',
        nicknames: ['Arena'],
        former_names: [{ name: 'Allianz Parque', until: '2026-05-03' }],
        team_slugs: ['palmeiras'],
        matched_by: 'provider_id',
      },
      providerFormerNames: [
        { name: 'Allianz Parque', from: '2016-08-31', until: '2025-05-22' },
        { name: 'Arena Palestra', from: '2010-01-01', until: '2010-07-09' },
      ],
    })
    .returning();
  ids.venue = v!.id;

  const params = { date: '2026-10-21' };
  await db.insert(apiResponse).values([
    {
      sport: 'football',
      apiVersion: 'v3',
      endpoint: '/fixtures',
      params,
      requestHash: requestHash('api-sports', 'football', '/fixtures', params),
      statusCode: 200,
      results: 1,
      errors: [],
      body: {
        get: 'fixtures',
        parameters: params,
        errors: [],
        results: 1,
        paging: { current: 1, total: 1 },
        response: [{ fixture: { id: 1 } }],
      },
      bodyHash: 'b1',
      fetchedAt: new Date('2026-10-21T10:00:00Z'),
    },
    {
      // resposta mais nova, porém com erro do fornecedor: não pode ser servida
      sport: 'football',
      apiVersion: 'v3',
      endpoint: '/fixtures',
      params,
      requestHash: requestHash('api-sports', 'football', '/fixtures', params),
      statusCode: 200,
      results: 0,
      errors: { rateLimit: 'Too many requests' },
      body: { get: 'fixtures', parameters: params, errors: { rateLimit: 'x' }, results: 0, response: [] },
      bodyHash: 'b2',
      fetchedAt: new Date('2026-10-21T11:00:00Z'),
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

  const t = await upsertTenant(db, {
    slug: 'demo',
    name: 'Demo',
    plan: 'enterprise',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'integração' })).key;

  app = buildServer({
    db,
    redis,
    keyPrefix,
    assetsBaseUrl: ASSETS,
    cdnPurger: cdn,
    changeFeed: { pollIntervalMs: 250 },
    // relógio fixo: o raw da agenda (10:00Z) ainda está no frescor do endpoint (5 min) → raw-hit
    now: () => new Date('2026-10-21T10:02:00Z'),
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

describe('tenants e chaves (Postgres)', () => {
  it('guarda só o hash da chave e marca o uso', async () => {
    const [row] = await db.select().from(apiKey).limit(1);
    expect(row!.secretHash).toMatch(/^scrypt\$/);
    expect(key).not.toContain(row!.secretHash);
    expect(key).toContain(row!.prefix);
    await get('/v1/sports');
    await expect
      .poll(async () => (await db.select().from(apiKey).where(eq(apiKey.id, row!.id)))[0]!.lastUsedAt)
      .not.toBeNull();
  });

  it('upsertTenant é idempotente e usa os módulos do plano', async () => {
    const a = await upsertTenant(db, { slug: 'radio', name: 'Rádio', plan: 'core_data' });
    const b = await upsertTenant(db, { slug: 'radio', name: 'Rádio FM', plan: 'fan_experience' });
    expect(a).toMatchObject({ created: true });
    expect(b).toEqual({ id: a.id, created: false });
    const k = await createApiKey(db, a.id);
    const ok = await app.inject({ url: '/v1/sports', headers: { 'x-galaxie-key': k.key } });
    expect(ok.statusCode).toBe(200);
  });

  it('chave revogada → 401; tenant sem core_data → 403', async () => {
    const t = await upsertTenant(db, {
      slug: 'semantic-only',
      name: 'S',
      plan: 'fan_experience',
      modules: ['semantic'],
    });
    const k = await createApiKey(db, t.id);
    const res = await app.inject({ url: '/v1/countries', headers: { 'x-galaxie-key': k.key } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'MODULE_NOT_IN_PLAN' });

    const k2 = await createApiKey(db, t.id);
    await revokeApiKey(db, k2.id);
    const revoked = await app.inject({ url: '/v1/countries', headers: { 'x-galaxie-key': k2.key } });
    expect(revoked.statusCode).toBe(401);
  });

  it('rate limit compartilhado no Valkey', async () => {
    const t = await upsertTenant(db, {
      slug: 'limitado',
      name: 'L',
      plan: 'core_data',
      rateLimitPerMinute: 3,
    });
    const k = await createApiKey(db, t.id);
    const call = () => app.inject({ url: '/v1/sports', headers: { 'x-galaxie-key': k.key } });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await call()).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const ttl = await redis.pttl(`${keyPrefix}rl:${t.id}:GET /v1/sports`);
    expect(ttl).toBeGreaterThan(0);
  });
});

describe('/v1 catálogo', () => {
  it('GET /v1/sports localiza pelo Accept-Language e conta competições', async () => {
    const res = await get('/v1/sports', { 'accept-language': 'es-AR,es;q=0.9' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('es-AR');
    expect(res.json().data).toEqual([
      { slug: 'basketball', name: 'Básquetbol', competitions: 1, mirror: '/mirror/basketball' },
      { slug: 'football', name: 'Fútbol', competitions: 8, mirror: '/mirror/football' },
    ]);
  });

  it('GET /v1/countries reescreve a bandeira para o nosso storage quando espelhada', async () => {
    const res = await get('/v1/countries?locale=pt-BR');
    const br = res.json().data.find((c: { code: string }) => c.code === 'BR');
    const ar = res.json().data.find((c: { code: string }) => c.code === 'AR');
    expect(br).toEqual({
      code: 'BR',
      name: 'Brasil',
      ioc_code: 'BRA',
      confederation: 'CONMEBOL',
      flag: `${ASSETS}/flags/br.svg`,
    });
    expect(ar).toMatchObject({ name: 'Argentina', flag: 'https://media.api-sports.io/flags/ar.svg' });
  });

  it('GET /v1/competitions filtra por país, tier, esporte e busca por apelido', async () => {
    const br = (await get('/v1/competitions?country=br&sport=football')).json();
    expect(br.data.map((c: { slug: string }) => c.slug)).toEqual(['brasileirao-serie-a']);
    expect(br.data[0]).toMatchObject({
      name: 'Brasileirão Série A',
      official_name: 'Serie A',
      tier: 1,
      type: 'league',
      country: { code: 'BR', name: 'Brasil' },
      logo: `${ASSETS}/football/leagues/71.png`,
      current_season: { year: 2026, label: '2026' },
    });
    const gloria = (await get('/v1/competitions?q=gloria%20eterna&locale=es-AR')).json();
    expect(gloria.data).toHaveLength(1);
    expect(gloria.data[0]).toMatchObject({ slug: 'libertadores', nicknames: ['La Gloria Eterna'] });
    const tier3 = (await get('/v1/competitions?tier=3')).json();
    expect(tier3.data).toHaveLength(5);
  });

  it('pagina por cursor sem repetir nem pular', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/competitions?sport=football&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const body = (await get(url)).json();
      seen.push(...body.data.map((c: { slug: string }) => c.slug));
      cursor = body.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    expect(seen.slice(0, 3).every((s) => !s.startsWith('liga-x'))).toBe(true);
    expect((await get('/v1/competitions?cursor=lixo')).statusCode).toBe(400);
  });

  it('GET /v1/competitions/{id} por UUID ou slug, com temporadas e IDs externos', async () => {
    const byId = (await get(`/v1/competitions/${ids['brasileirao-serie-a']}`)).json();
    const bySlug = (await get('/v1/competitions/brasileirao-serie-a')).json();
    expect(bySlug).toEqual(byId);
    expect(byId.external_ids).toEqual({ 'api-sports': '71' });
    expect(byId.seasons.map((s: { year: number }) => s.year)).toEqual([2026, 2025, 2024]);
    expect(byId.seasons[2]).toMatchObject({
      start_date: '2024-04-13',
      end_date: '2024-12-08',
      current: false,
    });
    const res = await get('/v1/competitions/nao-existe');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('GET standings agrupa, calcula saldo e formata no fuso pedido', async () => {
    const res = await get(`/v1/competitions/brasileirao-serie-a/seasons/2024/standings?tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toEqual({ year: 2024, label: '2024' });
    expect(body.updated_at).toBe('2024-12-09T00:00:00-03:00');
    expect(body.source).toBe('provider');
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].name).toBeNull();
    expect(body.groups[0].rows[0]).toMatchObject({
      rank: 1,
      points: 79,
      goal_diff: 30,
      participant: { name: 'Botafogo' },
    });

    const current = (await get('/v1/competitions/brasileirao-serie-a/seasons/current/standings')).json();
    expect(current).toMatchObject({ season: { year: 2026 }, groups: [], updated_at: null });
    expect((await get('/v1/competitions/brasileirao-serie-a/seasons/1999/standings')).statusCode).toBe(404);
    expect((await get('/v1/competitions/brasileirao-serie-a/seasons/abc/standings')).statusCode).toBe(400);
  });

  it('GET /v1/venues/{id}', async () => {
    const res = await get(`/v1/venues/${ids.venue}`);
    expect(res.json()).toEqual({
      id: ids.venue,
      name: 'Nubank Parque',
      city: 'São Paulo',
      country: { code: 'BR', name: 'Brasil' },
      capacity: 43713,
      surface: 'artificial turf',
      image: 'https://media.api-sports.io/football/venues/1.png',
      provider_name: 'Allianz Parque',
      // curadoria primeiro; o "Allianz Parque" do fornecedor já está coberto por ela
      former_names: [
        { name: 'Allianz Parque', from: null, until: '2026-05-03', origin: 'curated' },
        { name: 'Arena Palestra', from: '2010-01-01', until: '2010-07-09', origin: 'provider' },
      ],
    });
    expect((await get('/v1/venues/01a15f83-0f07-78a6-9de5-191d031f73d3')).statusCode).toBe(404);
  });
});

describe('cache, ETag e change feed', () => {
  it('serve do Valkey, responde 304 e purga ao receber mudança (dentro do SLA)', async () => {
    const url = '/v1/competitions/libertadores?locale=pt-BR';
    const first = await get(url);
    expect(first.headers['x-galaxie-cache']).toBe('MISS');
    expect(first.headers['cache-control']).toContain('s-maxage=86400');
    expect(first.headers['surrogate-key']).toContain(`competition:${ids.libertadores}`);
    const second = await get(url);
    expect(second.headers['x-galaxie-cache']).toBe('HIT');
    expect((await get(url, { 'if-none-match': first.headers.etag as string })).statusCode).toBe(304);

    await db
      .update(competition)
      .set({ name: 'CONMEBOL Libertadores Bridgestone' })
      .where(eq(competition.id, ids.libertadores!));
    // sem change feed, o cache segue servindo o valor antigo
    expect((await get(url)).json().official_name).toBe('CONMEBOL Libertadores');

    const t0 = Date.now();
    await publishChange(db, { topic: 'catalog', entityType: 'competition', entityId: ids.libertadores! });
    await expect
      .poll(async () => (await get(url)).json().official_name, { timeout: 5_000, interval: 50 })
      .toBe('CONMEBOL Libertadores Bridgestone');
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(cdn.purged.flat()).toContain(`competition:${ids.libertadores}`);
    const after = await get(url);
    expect(after.headers.etag).not.toBe(first.headers.etag);
  });
});

describe('/mirror', () => {
  it('serve o raw mais recente com sucesso, com o envelope e os headers do espelho', async () => {
    const res = await get('/mirror/football/fixtures?date=2026-10-21');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-galaxie-source']).toBe('raw-hit');
    expect(res.headers['x-galaxie-fetched-at']).toBe('2026-10-21T10:00:00.000Z');
    expect(res.headers['x-galaxie-asset-base']).toBe(ASSETS);
    expect(Object.keys(res.json())).toEqual(['get', 'parameters', 'errors', 'results', 'paging', 'response']);
    expect(res.json()).toMatchObject({ get: 'fixtures', results: 1, response: [{ fixture: { id: 1 } }] });
    const again = await get('/mirror/football/fixtures?date=2026-10-21');
    expect(again.headers['x-galaxie-cache']).toBe('HIT');
    expect(again.headers['x-galaxie-source']).toBe('raw-hit');
  });

  it('miss: envelope vazio, x-galaxie-source: miss e backfill ADHOC (sem chamar o fornecedor)', async () => {
    const url = '/mirror/football/fixtures/headtohead?h2h=121-131&last=5';
    const res = await get(url);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-galaxie-source']).toBe('miss');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.json()).toEqual({
      get: 'fixtures/headtohead',
      parameters: { h2h: '121-131', last: '5' },
      errors: [],
      results: 0,
      paging: { current: 1, total: 1 },
      response: [],
    });
    await get('/mirror/football/fixtures/headtohead?last=5&h2h=121-131');
    const hash = requestHash('api-sports', 'football', '/fixtures/headtohead', { h2h: '121-131', last: '5' });
    const [row] = await db.select().from(backfillRequest).where(eq(backfillRequest.requestHash, hash));
    expect(row).toMatchObject({
      sport: 'football',
      endpoint: '/fixtures/headtohead',
      params: { h2h: '121-131', last: '5' },
      priority: 'ADHOC',
      status: 'pending',
      hits: 2,
    });
  });

  it('o hash usado é o mesmo do cliente da api-sports', () => {
    const canonical = JSON.stringify(['api-sports', 'football', '/fixtures', { date: '2026-10-21' }]);
    expect(requestHash('api-sports', 'football', '/fixtures', { date: '2026-10-21' })).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    );
  });
});
