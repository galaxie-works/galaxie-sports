/**
 * Grade de canais e ofertas no onde assistir (`availability`) e nas rotas /v1/platforms, contra o
 * Postgres e o Valkey de desenvolvimento, com as tabelas e consultas reais da grade (`@galaxie/db`).
 * Nomes genéricos: nenhuma operadora, streaming ou canal real.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  assetCredit,
  broadcaster,
  broadcastOption,
  closeDb,
  competition,
  createDb,
  event,
  matchChannel,
  planChannel,
  planService,
  platform,
  platformAddon,
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
/** Jogo só com o detentor dos direitos ("canal a confirmar", opção `probable`). */
let probableEventId: string;
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
  const [ev, empty, probable] = await db.insert(event).values([game, game, game]).returning();
  eventId = ev!.id;
  emptyEventId = empty!.id;
  probableEventId = probable!.id;

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
  await db.insert(broadcastOption).values([
    option('Canal Aberto Exemplo', 'canal_aberto_exemplo', 'free_tv'),
    option('Canal Exemplo', 'canal_exemplo', 'pay_tv'),
    option('Streaming Exemplo', 'streaming_exemplo', 'streaming_svod'),
    // o outro jogo: o canal pago tem os direitos, mas o canal deste jogo não foi confirmado
    {
      ...option('Canal Exemplo', 'canal_exemplo', 'pay_tv'),
      eventId: probable!.id,
      status: 'probable' as const,
      confidence: '0.6',
    },
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
  // logo da operadora vindo da Commons, com o crédito (assets:platform-logos)
  const [logo] = await db
    .insert(asset)
    .values({
      kind: 'broadcaster_logo',
      sourceUrl: 'https://cdn.exemplo.test/operadora-exemplo.png',
      origin: 'commons',
    })
    .returning();
  await db.insert(assetCredit).values({
    assetId: logo!.id,
    source: 'wikimedia-commons',
    title: 'File:Operadora Exemplo logo.svg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Operadora_Exemplo_logo.svg',
    license: 'Public domain',
    attributionRequired: false,
  });
  await db.update(platform).set({ logoAssetId: logo!.id }).where(eq(platform.id, ids.operator));
  ids.rival = await addPlatform('br-operadora-exemplo-dois', 'Operadora Exemplo Dois', 'pay_tv_operator');
  // logo CC BY com a atribuição pedida pelo autor (`Attribution` da Commons): ela vira o texto do crédito
  const [rivalLogo] = await db
    .insert(asset)
    .values({
      kind: 'broadcaster_logo',
      sourceUrl: 'https://cdn.exemplo.test/operadora-exemplo-dois.png',
      origin: 'commons',
    })
    .returning();
  await db.insert(assetCredit).values({
    assetId: rivalLogo!.id,
    source: 'wikimedia-commons',
    title: 'File:Operadora Exemplo Dois logo.svg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Operadora_Exemplo_Dois_logo.svg',
    author: 'Fulano',
    license: 'CC BY 4.0',
    credit: 'Own work',
    attribution: 'Fulano / Operadora Exemplo Dois',
  });
  await db.update(platform).set({ logoAssetId: rivalLogo!.id }).where(eq(platform.id, ids.rival));
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
  // complementos: o canal inteiro e um canal numerado dele (o jogo não passa nesse canal)
  const addon = (slug: string, kind: 'service' | 'channel', channel: string | null, priceAmount: number) => ({
    platformId: ids.operator,
    slug,
    kind,
    refId: 'canal_exemplo',
    channel,
    name: channel ?? 'Canal Exemplo',
    priceAmount,
    priceCurrency: 'BRL',
    reviewStatus: 'approved' as const,
  });
  await db
    .insert(platformAddon)
    .values([
      addon('canal-exemplo', 'service', null, 19.9),
      addon('canal-exemplo-canal-exemplo-6', 'channel', 'Canal Exemplo 6', 4.9),
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
      logo: 'https://cdn.exemplo.test/operadora-exemplo.png',
      logo_credit: {
        source: 'Wikimedia Commons',
        title: 'File:Operadora Exemplo logo.svg',
        license: 'Public domain',
        attribution_required: false,
        attribution: null,
        text: 'Logo: Wikimedia Commons · Public domain',
      },
    });
    expect(body.availability.platforms[1].platform.logo_credit).toMatchObject({
      author: 'Fulano',
      license: 'CC BY 4.0',
      attribution_required: true,
      attribution: 'Fulano / Operadora Exemplo Dois',
      text: 'Logo: Fulano / Operadora Exemplo Dois · CC BY 4.0',
    });
    expect(body.availability.channel_status).toBe('confirmed');
    const plans = Object.fromEntries(
      (operator.plans as { name: string }[]).map((p) => [p.name, p]),
    ) as Record<string, unknown>;
    expect(plans['Plano Básico']).toMatchObject({ access: 'addon', included_services: [] });
    // o complemento do canal numerado não colapsa no canal: o jogo não passa nele
    expect(
      (operator.addons as { id: string; channel: string | null; price_from: number }[]).map((a) => [
        a.id,
        a.channel,
        a.price_from,
      ]),
    ).toEqual([['canal_exemplo', null, 19.9]]);
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
      channel_status: 'confirmed',
      match_channel: {
        phase: 'pre',
        state: 'to_confirm',
        headline: 'Canal deste jogo a confirmar',
        hint: 'O canal do jogo sai mais perto da partida.',
        channels: [],
      },
    });
    const own = (await get(`/v1/events/${emptyEventId}/where-to-watch?country=BR`, keys.own)).json();
    expect(own.availability.platforms).toEqual([]);
    expect(own.availability.your_operator).toMatchObject({ platform: { id: ids.operator }, plans: [] });
  });

  it('canal do jogo por momento: encerrado com canal = "Transmitido por"; sem canal = "Não confirmamos"', async () => {
    const [comp] = await db.select({ id: competition.id }).from(competition).limit(1);
    const past = new Date(Date.now() - 6 * 3_600_000);
    const finished = {
      sport: 'football',
      competitionId: comp!.id,
      startsAt: past,
      endsAtExpected: new Date(past.getTime() + 7_200_000),
      status: 'finished' as const,
    };
    const [withChannel, without] = await db.insert(event).values([finished, finished]).returning();
    // só o detentor dos direitos ("a confirmar") nos dois jogos
    const probable = {
      countryCode: 'BR',
      providerName: 'Canal Exemplo',
      broadcasterId: 'canal_exemplo',
      medium: 'pay_tv' as const,
      accessModel: 'subscription' as const,
      status: 'probable' as const,
      confidence: '0.80',
      evidence: [],
      flags: ['to_confirm'],
      producedBy: 'agent:wtw@v1',
    };
    await db.insert(broadcastOption).values([
      { ...probable, eventId: withChannel!.id },
      { ...probable, eventId: without!.id },
    ]);
    // o job wtw-channel confirmou o canal do primeiro jogo, também depois do apito
    const at = new Date(past.getTime() - 24 * 3_600_000);
    await db.insert(matchChannel).values({
      eventId: withChannel!.id,
      countryCode: 'BR',
      broadcasterId: 'canal_exemplo',
      confidence: '0.90',
      sourceKind: 'official',
      sourceUrl: 'https://canal.exemplo.test/escala-da-rodada',
      sourcePublisher: 'canal.exemplo.test',
      sourceExcerpt: 'Time A x Time B, sábado, no Canal Exemplo',
      evidence: [],
      phase: 'post',
      window: 'post',
      firstConfirmedAt: at,
      confirmedAt: new Date(),
      postConfirmedAt: new Date(),
    });

    const body = (await get(`/v1/events/${withChannel!.id}/where-to-watch?country=BR`, keys.plain)).json();
    expect(body.status).toBe('resolved');
    expect(body.to_confirm).toEqual([]);
    expect(body.options.map((o: { provider_id: string }) => o.provider_id)).toEqual(['canal_exemplo']);
    expect(body.availability).toMatchObject({
      channel_status: 'confirmed',
      pay_tv_channels: [{ id: 'canal_exemplo', name: 'Canal Exemplo' }],
      match_channel: {
        phase: 'post',
        state: 'confirmed',
        headline: 'Transmitido por Canal Exemplo',
        hint: null,
        channels: [
          {
            id: 'canal_exemplo',
            name: 'Canal Exemplo',
            medium: 'pay_tv',
            post_match: true,
            confirmed_at: at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            source: { kind: 'official', url: 'https://canal.exemplo.test/escala-da-rodada' },
          },
        ],
      },
    });

    const none = (await get(`/v1/events/${without!.id}/where-to-watch?country=BR`, keys.plain)).json();
    expect(none.availability.channel_status).toBe('to_confirm');
    expect(none.availability.match_channel).toEqual({
      phase: 'post',
      state: 'not_confirmed',
      headline: 'Não confirmamos o canal deste jogo',
      hint: null,
      channels: [],
    });
    const es = (
      await get(`/v1/events/${without!.id}/where-to-watch?country=BR&locale=es-AR`, keys.plain)
    ).json();
    expect(es.availability.match_channel.headline).toBe('No confirmamos el canal de este partido');
  });

  it('canal a confirmar: os detentores no lugar dos canais e as plataformas que os carregam', async () => {
    const res = await get(`/v1/events/${probableEventId}/where-to-watch?country=BR`, keys.plain);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.options).toEqual([]);
    expect(body.to_confirm.map((c: { provider_id: string }) => c.provider_id)).toEqual(['canal_exemplo']);
    expect(body.availability).toMatchObject({
      channel_status: 'to_confirm',
      free_tv: [],
      pay_tv_channels: [{ id: 'canal_exemplo', name: 'Canal Exemplo' }],
    });
    expect(platformIds(body)).toEqual([ids.operator, ids.rival]);
    expect(body.availability.platforms[0].plans.map((p: { name: string }) => p.name).sort()).toEqual([
      'Plano Básico',
      'Plano Top',
    ]);
    // a operadora só com a própria grade continua só com a dela
    const own = (await get(`/v1/events/${probableEventId}/where-to-watch?country=BR`, keys.own)).json();
    expect(platformIds(own)).toEqual([ids.operator]);
    expect(own.availability.your_operator.plans).toHaveLength(2);
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
