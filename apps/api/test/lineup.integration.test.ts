/**
 * Grade de canais e ofertas no onde assistir (`availability`) e nas rotas /v1/platforms, contra o
 * Postgres e o Valkey de desenvolvimento. A grade vem da fonte de fixtures (nomes genéricos); as opções
 * publicadas e a biblioteca de emissoras, do banco.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  broadcaster,
  broadcastOption,
  closeDb,
  competition,
  createDb,
  event,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';
import { fixtureLineupSource, OPERATOR_ID, RIVAL_ID, STREAMING_ID } from '../src/lineup/fixtures.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-lineup-${randomBytes(4).toString('hex')}:`;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let eventId: string;
let emptyEventId: string;
/** Chaves: sem operadora, operadora só com a própria grade, operadora vendo as concorrentes, outro mercado. */
const keys = { plain: '', own: '', others: '', arOnly: '' };
let calls: { fn: string; args: unknown }[];

const get = (url: string, k: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k } });
const ids = (body: { availability: { platforms: { platform: { id: string } }[] } }) =>
  body.availability.platforms.map((p) => p.platform.id);

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga-exemplo', name: 'Liga Exemplo', type: 'league', tier: 1 })
    .returning();
  const kickoff = new Date(Date.now() + 2 * 24 * 3_600_000);
  const game = {
    sport: 'football',
    competitionId: comp!.id,
    startsAt: kickoff,
    endsAtExpected: new Date(kickoff.getTime() + 7_200_000),
  };
  const [ev, empty] = await db.insert(event).values([game, game]).returning();
  eventId = ev!.id;
  emptyEventId = empty!.id;

  const market = (name: string, medium: 'free_tv' | 'pay_tv' | 'streaming_svod') => ({
    BR: {
      name,
      medium,
      accessModel: medium === 'free_tv' ? 'free' : 'subscription',
      channels: [],
      domains: [],
    },
  });
  await db.insert(broadcaster).values([
    {
      id: 'canal_exemplo',
      name: 'Canal Exemplo',
      kind: 'pay_tv',
      countries: ['BR'],
      markets: market('Canal Exemplo', 'pay_tv') as never,
      logoSourceUrl: 'https://cdn.exemplo.test/canal-exemplo.png',
    },
    {
      id: 'canal_aberto_exemplo',
      name: 'Canal Aberto Exemplo',
      kind: 'free_tv',
      countries: ['BR'],
      markets: market('Canal Aberto Exemplo', 'free_tv') as never,
      logoSourceUrl: 'https://cdn.exemplo.test/canal-aberto-exemplo.png',
    },
    {
      id: 'streaming_exemplo',
      name: 'Streaming Exemplo',
      kind: 'streaming',
      countries: ['BR'],
      markets: market('Streaming Exemplo', 'streaming_svod') as never,
      logoSourceUrl: 'https://cdn.exemplo.test/streaming-exemplo.png',
    },
  ]);
  const option = (providerName: string, broadcasterId: string, medium: 'free_tv' | 'pay_tv') => ({
    eventId,
    countryCode: 'BR',
    providerName,
    broadcasterId,
    medium,
    accessModel: medium === 'free_tv' ? ('free' as const) : ('subscription' as const),
    status: 'confirmed' as const,
    confidence: '0.95',
    evidence: [],
    producedBy: 'editorial:teste',
  });
  await db
    .insert(broadcastOption)
    .values([
      option('Canal Aberto Exemplo', 'canal_aberto_exemplo', 'free_tv'),
      option('Canal Exemplo', 'canal_exemplo', 'pay_tv'),
    ]);

  const tenant = async (slug: string, markets = ['BR', 'AR']) => {
    const t = await upsertTenant(db, { slug, name: slug, plan: 'fan_experience', markets });
    return { id: t.id, key: (await createApiKey(db, t.id, { env: 'test' })).key };
  };
  const plain = await tenant('lineup-sem-operadora');
  const own = await tenant('lineup-operadora-propria');
  const others = await tenant('lineup-operadora-todas');
  const arOnly = await tenant('lineup-ar', ['AR']);
  Object.assign(keys, { plain: plain.key, own: own.key, others: others.key, arOnly: arOnly.key });

  const fixture = fixtureLineupSource({
    [own.id]: {
      platformId: OPERATOR_ID,
      showOtherOperators: false,
      emailDomains: ['operadora.exemplo.test'],
    },
    [others.id]: { platformId: OPERATOR_ID, showOtherOperators: true, emailDomains: [] },
  });
  calls = fixture.calls;
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usage: false,
    lineup: { source: fixture.source, minReviewStatus: 'reviewed' },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
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

describe('GET /v1/events/{id}/where-to-watch → availability', () => {
  it('sem operadora: TV aberta, canais pagos e todas as plataformas, com plano e streamings inclusos', async () => {
    const res = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.plain);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.availability.free_tv).toEqual([
      {
        id: 'canal_aberto_exemplo',
        name: 'Canal Aberto Exemplo',
        logo: 'https://cdn.exemplo.test/canal-aberto-exemplo.png',
        logo_dark: null,
      },
    ]);
    expect(body.availability.pay_tv_channels.map((c: { id: string }) => c.id)).toEqual(['canal_exemplo']);
    expect(ids(body)).toEqual([OPERATOR_ID, RIVAL_ID, STREAMING_ID]);
    expect(body.availability.your_operator).toBeNull();
    expect(body.availability.platforms[0]).toMatchObject({
      platform: { name: 'Operadora Exemplo', kind: 'pay_tv_operator', country: 'BR' },
      plans: [
        {
          name: 'Plano Top',
          access: 'included',
          via_channels: [
            {
              id: 'canal_exemplo',
              name: 'Canal Exemplo',
              logo: 'https://cdn.exemplo.test/canal-exemplo.png',
              access: 'included',
            },
          ],
          included_services: [
            {
              id: 'streaming_exemplo',
              name: 'Streaming Exemplo',
              logo: 'https://cdn.exemplo.test/streaming-exemplo.png',
            },
          ],
        },
        { name: 'Plano Básico', access: 'addon' },
      ],
    });
    // as opções seguem como antes (o bloco é aditivo)
    expect(body.options.map((o: { provider_id: string }) => o.provider_id)).toEqual([
      'canal_aberto_exemplo',
      'canal_exemplo',
    ]);
    // piso do servidor e os canais das opções publicadas chegam à consulta da grade
    expect(calls.find((c) => c.fn === 'availabilityForChannels')?.args).toMatchObject({
      country: 'BR',
      minReview: 'reviewed',
      includeStreaming: true,
      channelIds: ['canal_aberto_exemplo', 'canal_exemplo'],
    });
    expect(res.headers['surrogate-key']).toContain(`platform:${OPERATOR_ID}`);
  });

  it('operadora com show_other_operators = false: só a própria e os streamings, e your_operator', async () => {
    const before = calls.length;
    const res = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.own);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual([OPERATOR_ID, STREAMING_ID]);
    expect(body.availability.your_operator).toMatchObject({
      platform: { id: OPERATOR_ID, name: 'Operadora Exemplo' },
      plans: [{ name: 'Plano Top' }, { name: 'Plano Básico' }],
    });
    expect(calls.slice(before).find((c) => c.fn === 'availabilityForChannels')?.args).toMatchObject({
      onlyPlatformId: OPERATOR_ID,
      includeStreaming: true,
    });
    // a resposta do tenant sem operadora (já em cache) não vaza para ele, nem a dele para os outros
    expect(res.headers['x-galaxie-cache']).toBe('MISS');
    const again = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.own);
    expect(again.headers['x-galaxie-cache']).toBe('HIT');
    expect(ids(again.json())).toEqual([OPERATOR_ID, STREAMING_ID]);
  });

  it('operadora com show_other_operators = true: todas, com a própria primeiro', async () => {
    const res = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.others);
    const body = res.json();
    expect(ids(body)).toEqual([OPERATOR_ID, RIVAL_ID, STREAMING_ID]);
    expect(body.availability.your_operator.platform.id).toBe(OPERATOR_ID);
  });

  it('jogo sem opção publicada: sem cartões, e a operadora do tenant aparece sem planos', async () => {
    const plain = (await get(`/v1/events/${emptyEventId}/where-to-watch?country=BR`, keys.plain)).json();
    expect(plain.availability).toEqual({
      free_tv: [],
      pay_tv_channels: [],
      platforms: [],
      your_operator: null,
    });
    const own = (await get(`/v1/events/${emptyEventId}/where-to-watch?country=BR`, keys.own)).json();
    expect(own.availability.platforms).toEqual([]);
    expect(own.availability.your_operator).toMatchObject({ platform: { id: OPERATOR_ID }, plans: [] });
  });
});

describe('GET /v1/platforms', () => {
  it('lista as plataformas do país com o piso do servidor', async () => {
    const res = await get('/v1/platforms?country=br', keys.plain);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((p: { id: string }) => p.id)).toEqual([OPERATOR_ID, RIVAL_ID, STREAMING_ID]);
    expect(calls.filter((c) => c.fn === 'listPlatforms').at(-1)?.args).toEqual({
      country: 'BR',
      minReview: 'reviewed',
    });
  });

  it('operadora sem show_other_operators não vê as concorrentes', async () => {
    const own = (await get('/v1/platforms?country=BR', keys.own)).json();
    expect(own.data.map((p: { id: string }) => p.id)).toEqual([OPERATOR_ID, STREAMING_ID]);
    const others = (await get('/v1/platforms?country=BR', keys.others)).json();
    expect(others.data).toHaveLength(3);
  });

  it('país fora dos mercados do tenant → 403', async () => {
    expect((await get('/v1/platforms?country=BR', keys.arOnly)).statusCode).toBe(403);
  });
});

describe('GET /v1/platforms/{id}/lineup', () => {
  it('grade de cada plano com canais e streamings', async () => {
    const res = await get(`/v1/platforms/${OPERATOR_ID}/lineup`, keys.plain);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      platform: { id: OPERATOR_ID, slug: 'operadora-exemplo' },
      plans: [
        {
          name: 'Plano Top',
          channels: [
            { id: 'canal_exemplo', name: 'Canal Exemplo', access: 'included' },
            { id: 'canal_aberto_exemplo', name: 'Canal Aberto Exemplo', access: 'included' },
          ],
          services: [{ id: 'streaming_exemplo', access: 'included' }],
        },
      ],
    });
  });

  it('concorrente escondida da operadora → 404; com show_other_operators → 200', async () => {
    expect((await get(`/v1/platforms/${RIVAL_ID}/lineup`, keys.own)).statusCode).toBe(404);
    expect((await get(`/v1/platforms/${STREAMING_ID}/lineup`, keys.own)).statusCode).toBe(200);
    expect((await get(`/v1/platforms/${RIVAL_ID}/lineup`, keys.others)).statusCode).toBe(200);
  });

  it('inexistente → 404; país fora do plano → 403 (também com a resposta em cache)', async () => {
    expect((await get('/v1/platforms/nao-existe/lineup', keys.plain)).statusCode).toBe(404);
    expect((await get(`/v1/platforms/${OPERATOR_ID}/lineup`, keys.arOnly)).statusCode).toBe(403);
  });
});
