/**
 * Grade de canais e ofertas no onde assistir (`availability`) e nas rotas /v1/platforms, contra o
 * Postgres e o Valkey de desenvolvimento, com as tabelas e consultas reais da grade (`@galaxie/db`).
 * Nomes genéricos: nenhuma operadora, streaming ou canal real.
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
  planChannel,
  planService,
  platform,
  platformPlan,
  runMigrations,
  setTenantOperator,
  sport,
  type Database,
  type LineupReviewStatus,
  type PlatformKind,
} from '@galaxie/db';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';

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
/** Ids das plataformas: a operadora do cliente, a concorrente, o streaming e uma ainda em rascunho. */
const ids = { operator: '', rival: '', streaming: '', draft: '' };
/** Chaves: sem operadora, operadora só com a própria grade, operadora vendo as concorrentes, outro mercado. */
const keys = { plain: '', own: '', others: '', arOnly: '' };

const get = (url: string, k: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k } });
const platformIds = (body: { availability: { platforms: { platform: { id: string } }[] } }) =>
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

  // biblioteca de emissoras: canais e streamings (logo com origem http, sem storage)
  const lib = (id: string, name: string, kind: 'free_tv' | 'pay_tv' | 'streaming') => ({
    id,
    name,
    kind,
    countries: ['BR'],
    markets: {} as never,
    logoSourceUrl: `https://cdn.exemplo.test/${id}.png`,
  });
  await db
    .insert(broadcaster)
    .values([
      lib('canal_exemplo', 'Canal Exemplo', 'pay_tv'),
      lib('canal_aberto_exemplo', 'Canal Aberto Exemplo', 'free_tv'),
      lib('streaming_exemplo', 'Streaming Exemplo', 'streaming'),
      lib('streaming_extra_exemplo', 'Streaming Extra Exemplo', 'streaming'),
    ]);

  // opções publicadas do jogo: TV aberta, canal pago e o streaming
  const option = (
    providerName: string,
    broadcasterId: string,
    medium: 'free_tv' | 'pay_tv' | 'streaming_svod',
  ) => ({
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
      option('Streaming Exemplo', 'streaming_exemplo', 'streaming_svod'),
    ]);

  // grade: plataformas, planos e vínculos (aprovados, salvo a plataforma em rascunho)
  const addPlatform = async (
    slug: string,
    name: string,
    kind: PlatformKind,
    reviewStatus: LineupReviewStatus = 'approved',
    broadcasterId: string | null = null,
  ) => {
    const [p] = await db
      .insert(platform)
      .values({ slug, name, kind, country: 'BR', reviewStatus, broadcasterId })
      .returning();
    return p!.id;
  };
  const addPlan = async (
    platformId: string,
    slug: string,
    name: string,
    reviewStatus: LineupReviewStatus = 'approved',
  ) => {
    const [p] = await db
      .insert(platformPlan)
      .values({ platformId, slug, name, country: 'BR', reviewStatus })
      .returning();
    return p!.id;
  };
  ids.operator = await addPlatform('br-operadora-exemplo', 'Operadora Exemplo', 'pay_tv_operator');
  ids.rival = await addPlatform('br-operadora-exemplo-dois', 'Operadora Exemplo Dois', 'pay_tv_operator');
  ids.streaming = await addPlatform(
    'br-streaming-exemplo',
    'Streaming Exemplo',
    'streaming',
    'approved',
    'streaming_exemplo',
  );
  ids.draft = await addPlatform('br-operadora-rascunho', 'Operadora Rascunho', 'vmvpd', 'draft');
  const top = await addPlan(ids.operator, 'top', 'Plano Top');
  const basic = await addPlan(ids.operator, 'basico', 'Plano Básico');
  const rivalPlan = await addPlan(ids.rival, 'completo', 'Plano Completo');
  await addPlan(ids.streaming, 'padrao', 'Plano Padrão');
  const draftPlan = await addPlan(ids.draft, 'esportes', 'Plano Esportes', 'draft');
  const link = (
    planId: string,
    channelId: string,
    access: 'included' | 'addon',
    reviewStatus: LineupReviewStatus = 'approved',
  ) => ({ planId, channelId, access, reviewStatus });
  await db
    .insert(planChannel)
    .values([
      link(top, 'canal_exemplo', 'included'),
      link(basic, 'canal_exemplo', 'addon'),
      link(rivalPlan, 'canal_exemplo', 'addon'),
      link(draftPlan, 'canal_exemplo', 'included', 'draft'),
    ]);
  await db.insert(planService).values([
    { planId: top, serviceId: 'streaming_exemplo', access: 'included', reviewStatus: 'approved' },
    { planId: top, serviceId: 'streaming_extra_exemplo', access: 'addon', reviewStatus: 'approved' },
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
  await setTenantOperator(db, own.id, {
    platformId: ids.operator,
    showOtherOperators: false,
    emailDomains: ['operadora.exemplo.test'],
  });
  await setTenantOperator(db, others.id, { platformId: ids.operator, showOtherOperators: true });

  app = buildServer({ db, redis, keyPrefix, usage: false });
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
  it('sem operadora: TV aberta, canais pagos e as plataformas aprovadas, com plano e streamings inclusos', async () => {
    const res = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.plain);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.availability.free_tv).toEqual([
      {
        id: 'canal_aberto_exemplo',
        name: 'Canal Aberto Exemplo',
        logo: 'https://cdn.exemplo.test/canal_aberto_exemplo.png',
        logo_dark: null,
      },
    ]);
    expect(body.availability.pay_tv_channels.map((c: { id: string }) => c.id)).toEqual(['canal_exemplo']);
    // a plataforma em rascunho fica abaixo do piso (approved): não aparece
    expect(platformIds(body)).toEqual([ids.operator, ids.rival, ids.streaming]);
    expect(body.availability.your_operator).toBeNull();
    const operator = body.availability.platforms[0];
    expect(operator.platform).toMatchObject({
      name: 'Operadora Exemplo',
      kind: 'pay_tv_operator',
      country: 'BR',
    });
    const plans = Object.fromEntries(
      (operator.plans as { name: string }[]).map((p) => [p.name, p]),
    ) as Record<string, unknown>;
    expect(plans['Plano Básico']).toMatchObject({ access: 'addon', included_services: [] });
    expect(plans['Plano Top']).toMatchObject({
      access: 'included',
      via_channels: [
        {
          id: 'canal_exemplo',
          name: 'Canal Exemplo',
          logo: 'https://cdn.exemplo.test/canal_exemplo.png',
          access: 'included',
        },
      ],
      // o adicional pago não conta como incluso
      included_services: [{ id: 'streaming_exemplo', name: 'Streaming Exemplo' }],
    });
    // o streaming das opções é a própria plataforma: cartão com o logo da biblioteca, sem se listar
    expect(body.availability.platforms[2]).toMatchObject({
      platform: {
        id: ids.streaming,
        broadcaster_id: 'streaming_exemplo',
        logo: 'https://cdn.exemplo.test/streaming_exemplo.png',
      },
      plans: [{ name: 'Plano Padrão', access: 'included', via_channels: [], included_services: [] }],
    });
    // as opções seguem como antes (o bloco é aditivo)
    expect(body.options).toHaveLength(3);
    expect(res.headers['surrogate-key']).toContain(`platform:${ids.operator}`);
  });

  it('operadora com show_other_operators = false: só a própria e os streamings, e your_operator', async () => {
    const res = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.own);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-galaxie-cache']).toBe('MISS');
    const body = res.json();
    expect(platformIds(body)).toEqual([ids.operator, ids.streaming]);
    expect(body.availability.your_operator.platform).toMatchObject({
      id: ids.operator,
      name: 'Operadora Exemplo',
    });
    expect(body.availability.your_operator.plans).toHaveLength(2);
    // a resposta em cache é a dele, não a do tenant sem operadora
    const again = await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.own);
    expect(again.headers['x-galaxie-cache']).toBe('HIT');
    expect(platformIds(again.json())).toEqual([ids.operator, ids.streaming]);
  });

  it('operadora com show_other_operators = true: todas, com a própria primeiro', async () => {
    const body = (await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keys.others)).json();
    expect(platformIds(body)).toEqual([ids.operator, ids.rival, ids.streaming]);
    expect(body.availability.your_operator.platform.id).toBe(ids.operator);
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
    expect(own.availability.your_operator).toMatchObject({ platform: { id: ids.operator }, plans: [] });
  });

  it('piso do servidor mais baixo (LINEUP_MIN_REVIEW_STATUS=draft) mostra a plataforma em rascunho', async () => {
    const draftApp = buildServer({
      db,
      keyPrefix: `${keyPrefix}draft:`,
      usage: false,
      lineup: { minReviewStatus: 'draft' },
    });
    await draftApp.ready();
    const res = await draftApp.inject({
      method: 'GET',
      url: `/v1/events/${eventId}/where-to-watch?country=BR`,
      headers: { 'x-galaxie-key': keys.plain },
    });
    expect(platformIds(res.json())).toContain(ids.draft);
    await draftApp.close();
  });
});

describe('GET /v1/platforms', () => {
  it('lista as plataformas aprovadas do país', async () => {
    const res = await get('/v1/platforms?country=br', keys.plain);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { id: string }[];
    expect(data.map((p) => p.id).sort()).toEqual([ids.operator, ids.rival, ids.streaming].sort());
  });

  it('operadora sem show_other_operators não vê as concorrentes', async () => {
    const own = (await get('/v1/platforms?country=BR', keys.own)).json().data as { id: string }[];
    expect(own.map((p) => p.id).sort()).toEqual([ids.operator, ids.streaming].sort());
    const others = (await get('/v1/platforms?country=BR', keys.others)).json().data;
    expect(others).toHaveLength(3);
  });

  it('país fora dos mercados do tenant → 403', async () => {
    expect((await get('/v1/platforms?country=BR', keys.arOnly)).statusCode).toBe(403);
  });
});

describe('GET /v1/platforms/{id}/lineup', () => {
  it('grade de cada plano com canais e streamings', async () => {
    const res = await get(`/v1/platforms/${ids.operator}/lineup`, keys.plain);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.platform).toMatchObject({ id: ids.operator, slug: 'br-operadora-exemplo' });
    const top = (body.plans as { name: string }[]).find((p) => p.name === 'Plano Top');
    expect(top).toMatchObject({
      channels: [{ id: 'canal_exemplo', name: 'Canal Exemplo', access: 'included' }],
      services: [
        { id: 'streaming_exemplo', access: 'included' },
        { id: 'streaming_extra_exemplo', access: 'addon' },
      ],
    });
  });

  it('concorrente escondida da operadora → 404; com show_other_operators → 200', async () => {
    expect((await get(`/v1/platforms/${ids.rival}/lineup`, keys.own)).statusCode).toBe(404);
    expect((await get(`/v1/platforms/${ids.streaming}/lineup`, keys.own)).statusCode).toBe(200);
    expect((await get(`/v1/platforms/${ids.rival}/lineup`, keys.others)).statusCode).toBe(200);
  });

  it('rascunho e inexistente → 404; país fora do plano → 403 (também com a resposta em cache)', async () => {
    expect((await get(`/v1/platforms/${ids.draft}/lineup`, keys.plain)).statusCode).toBe(404);
    expect((await get('/v1/platforms/nao-existe/lineup', keys.plain)).statusCode).toBe(404);
    expect((await get(`/v1/platforms/${ids.operator}/lineup`, keys.arOnly)).statusCode).toBe(403);
  });
});
