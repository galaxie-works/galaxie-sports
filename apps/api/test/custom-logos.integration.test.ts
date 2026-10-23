import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Competition, Event, SearchResponse, Team } from '@galaxie/contracts';
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
  writeRuntimeSetting,
  type Database,
} from '@galaxie/db';
import { DbCustomLogos } from '../src/assets/custom-logos.js';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
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
const PROVIDER_PAL = `${ASSETS}/football/teams/121.png`;
const ACERVO_PAL = `${ASSETS}/acervo/football/teams/palmeiras-uuid.0b6e3a000000.svg`;
const PROVIDER_FLA = `${ASSETS}/football/teams/127.png`;
const PROVIDER_SERIE_A = `${ASSETS}/football/leagues/71.png`;
const ACERVO_SERIE_A = `${ASSETS}/acervo/football/leagues/serie-a-uuid.2fb34a000000.svg`;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let logos: DbCustomLogos;
let key: string;
const ids: Record<string, string> = {};

const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

async function flag(value: 'on' | 'off' | null) {
  await writeRuntimeSetting(db, { key: 'ASSETS_CUSTOM_LOGOS', value, valueType: 'enum', by: 'teste' });
  await logos.refresh();
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values({ code: 'BR', name: { en: 'Brazil' } });
  const [pal, fla, serieA, palAcervo, serieAAcervo] = await db
    .insert(asset)
    .values([
      {
        kind: 'team_logo',
        sourceUrl: 'https://media.api-sports.io/football/teams/121.png',
        storageKey: 'football/teams/121.png',
        palette: { version: 1, dominant: '#006437', secondary: null, monochrome: false },
      },
      {
        kind: 'team_logo',
        sourceUrl: 'https://media.api-sports.io/football/teams/127.png',
        storageKey: 'football/teams/127.png',
      },
      {
        kind: 'league_logo',
        sourceUrl: 'https://media.api-sports.io/football/leagues/71.png',
        storageKey: 'football/leagues/71.png',
      },
      {
        kind: 'team_logo',
        origin: 'acervo',
        acervo: 'exemplo',
        sourceUrl: 'acervo://exemplo/teams/br/palmeiras.svg',
        storageKey: 'acervo/football/teams/palmeiras-uuid.0b6e3a000000.svg',
        palette: { version: 1, dominant: '#0b6e3a', secondary: null, monochrome: false },
      },
      {
        kind: 'league_logo',
        origin: 'acervo',
        acervo: 'exemplo',
        sourceUrl: 'acervo://exemplo/competitions/br/serie-a.svg',
        storageKey: 'acervo/football/leagues/serie-a-uuid.2fb34a000000.svg',
      },
    ])
    .returning({ id: asset.id });
  const [c] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'brasileirao-serie-a',
      name: 'Serie A',
      countryCode: 'BR',
      type: 'league',
      tier: 1,
      logoAssetId: serieA!.id,
      customLogoAssetId: serieAAcervo!.id,
    })
    .returning({ id: competition.id });
  ids.serieA = c!.id;
  const teams = await db
    .insert(participant)
    .values([
      {
        sport: 'football',
        kind: 'club',
        name: 'Palmeiras',
        countryCode: 'BR',
        logoAssetId: pal!.id,
        customLogoAssetId: palAcervo!.id,
      },
      // sem logo do acervo: continua com o do fornecedor mesmo com a flag ligada
      { sport: 'football', kind: 'club', name: 'Flamengo', countryCode: 'BR', logoAssetId: fla!.id },
    ])
    .returning({ id: participant.id });
  ids.palmeiras = teams[0]!.id;
  ids.flamengo = teams[1]!.id;
  const [e] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: ids.serieA,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAtExpected: new Date(Date.now() + 86_400_000 + 7_200_000),
      status: 'scheduled',
    })
    .returning({ id: event.id });
  ids.event = e!.id;
  await db.insert(eventParticipant).values([
    { eventId: ids.event, participantId: ids.palmeiras, side: 'home' },
    { eventId: ids.event, participantId: ids.flamengo, side: 'away' },
  ]);

  const t = await upsertTenant(db, {
    slug: 'logos',
    name: 'Logos',
    plan: 'core_data',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'logos' })).key;
  // env sem a flag: vale o padrão (desligada)
  logos = new DbCustomLogos(db, { env: {} });
  await logos.refresh();
  app = buildServer({ db, redis, keyPrefix, assetsBaseUrl: ASSETS, customLogos: logos });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    const keys = await redis.keys(`${keyPrefix}*`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  }
  if (db) await closeDb(db);
  if (admin) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

describe('ASSETS_CUSTOM_LOGOS', () => {
  it('desligada (padrão): logos do fornecedor, com origem', async () => {
    expect(logos.enabled()).toBe(false);
    const res = await get(`/v1/teams/${ids.palmeiras}`);
    expect(res.statusCode).toBe(200);
    const team = res.json<Team>();
    expect(team).toMatchObject({ logo: PROVIDER_PAL, logo_source: 'provider' });
    expect(team.colors?.primary).toBe('#006437');
    const again = await get(`/v1/teams/${ids.palmeiras}`);
    expect(again.headers['x-galaxie-cache']).toBe('HIT');
  });

  it('ligada no painel: o escudo do acervo vale em tudo que tem mapeamento, sem reiniciar', async () => {
    await flag('on');
    expect(logos.enabled()).toBe(true);

    const res = await get(`/v1/teams/${ids.palmeiras}`);
    // a resposta em cache da flag desligada não é servida: a versão da flag está na chave
    expect(res.headers['x-galaxie-cache']).not.toBe('HIT');
    const team = res.json<Team>();
    expect(team).toMatchObject({ logo: ACERVO_PAL, logo_source: 'acervo' });
    // as cores do time vêm do escudo novo
    expect(team.colors?.primary).toBe('#0b6e3a');
    expect((await get(`/v1/teams/${ids.flamengo}`)).json<Team>()).toMatchObject({
      logo: PROVIDER_FLA,
      logo_source: 'provider',
    });

    const ev = (await get(`/v1/events/${ids.event}`)).json<Event>();
    expect(ev.competition?.logo).toBe(ACERVO_SERIE_A);
    expect(ev.participants.map((p) => p.logo)).toEqual([ACERVO_PAL, PROVIDER_FLA]);

    const comp = (await get(`/v1/competitions/${ids.serieA}`)).json<Competition>();
    expect(comp).toMatchObject({ logo: ACERVO_SERIE_A, logo_source: 'acervo' });

    const search = (await get('/v1/search?q=palmeiras&types=team')).json<SearchResponse>();
    expect(search.data[0]).toMatchObject({ type: 'team', image: ACERVO_PAL });

    const page = (await get(`/v1/teams?country=BR`)).json<{ data: Team[] }>();
    expect(page.data.find((t) => t.id === ids.palmeiras)?.logo).toBe(ACERVO_PAL);
  });

  it('desligada de novo: volta na hora para o fornecedor e o cache não devolve o escudo do acervo', async () => {
    await flag('off');
    const res = await get(`/v1/teams/${ids.palmeiras}`);
    expect(res.headers['x-galaxie-cache']).not.toBe('HIT');
    expect(res.json<Team>()).toMatchObject({ logo: PROVIDER_PAL, logo_source: 'provider' });
    const ev = (await get(`/v1/events/${ids.event}`)).json<Event>();
    expect(ev.competition?.logo).toBe(PROVIDER_SERIE_A);
    expect((await get(`/v1/teams/${ids.palmeiras}`)).headers['x-galaxie-cache']).toBe('HIT');
  });

  it('voltar ao padrão (apagar a sobrescrita) segue o env do contêiner', async () => {
    await flag(null);
    expect(logos.enabled()).toBe(false);
    const fromEnv = new DbCustomLogos(db, { env: { ASSETS_CUSTOM_LOGOS: 'on' } });
    await fromEnv.refresh();
    expect(fromEnv.enabled()).toBe(true);
  });
});
