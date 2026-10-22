import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  participant,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import {
  applyAgentResult,
  loadWtwConfig,
  syncBroadcasterLibrary,
  validateCandidates,
} from '@galaxie/where-to-watch';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-wtw-${randomBytes(4).toString('hex')}:`;
const ADMIN_KEY = generateAdminKey();

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let keyArOnly: string;
let keyNoModule: string;
let eventId: string;
const cdn = new RecordingCdnPurger();
const config = loadWtwConfig({ env: { WTW_BLOCKLIST: 'Operadora Bloqueada' } });
const KICKOFF = new Date(Date.now() + 2 * 24 * 3_600_000);

const get = (url: string, k = key, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k, ...headers } });
const adminHeaders = { 'x-galaxie-admin-key': ADMIN_KEY, 'x-galaxie-actor': 'editor.ana' };

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'conmebol-libertadores', name: 'Libertadores', type: 'cup', tier: 1 })
    .returning();
  const [home, away] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras' },
      { sport: 'football', kind: 'club', name: 'Fluminense' },
    ])
    .returning();
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      startsAt: KICKOFF,
      endsAtExpected: new Date(KICKOFF.getTime() + 7_200_000),
    })
    .returning();
  eventId = ev!.id;
  await db.insert(eventParticipant).values([
    { eventId, participantId: home!.id, side: 'home' },
    { eventId, participantId: away!.id, side: 'away' },
  ]);

  // estado inicial publicado pelo agente: Globo (aberta) + Disney+
  const now = new Date();
  const opts = validateCandidates(
    [
      {
        broadcaster: 'TV Globo',
        evidence: [
          {
            url: 'https://ge.globo.com/agenda',
            excerpt: 'Globo transmite',
            accessible: true,
            mentionsBroadcaster: true,
          },
        ],
      },
      {
        broadcaster: 'Disney+',
        evidence: [
          {
            url: 'https://www.espn.com.br/agenda',
            excerpt: 'Disney+ transmite',
            accessible: true,
            mentionsBroadcaster: true,
          },
        ],
      },
    ],
    {
      directory: config.directory('BR'),
      competitionSlug: 'conmebol-libertadores',
      eventStartsAt: KICKOFF,
      now,
    },
  ).options;
  await applyAgentResult(db, { eventId, country: 'BR', options: opts, retractMissing: true, now });

  const t = await upsertTenant(db, {
    slug: 'wtw',
    name: 'WTW',
    plan: 'fan_experience',
    markets: ['BR', 'AR'],
  });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  const ar = await upsertTenant(db, { slug: 'wtw-ar', name: 'AR', plan: 'fan_experience', markets: ['AR'] });
  keyArOnly = (await createApiKey(db, ar.id, { env: 'test' })).key;
  const core = await upsertTenant(db, { slug: 'core', name: 'Core', plan: 'core_data' });
  keyNoModule = (await createApiKey(db, core.id, { env: 'test' })).key;

  app = buildServer({
    db,
    redis,
    keyPrefix,
    cdnPurger: cdn,
    changeFeed: { pollIntervalMs: 250 },
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)] },
    wtwConfig: config,
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

describe('GET /v1/events/{id}/where-to-watch', () => {
  it('lista as opções publicadas com fontes, ordenadas por meio', async () => {
    const res = await get(`/v1/events/${eventId}/where-to-watch?country=br&tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ event_id: eventId, country: 'BR', status: 'resolved', message: null });
    expect(body.options.map((o: { provider: string; medium: string }) => [o.provider, o.medium])).toEqual([
      ['Globo', 'free_tv'],
      ['Disney+', 'streaming_svod'],
    ]);
    expect(body.options[0]).toMatchObject({
      provider_id: 'globo',
      status: 'confirmed',
      confidence: 1,
      region: null,
      sources: [{ publisher: 'ge.globo.com', url: 'https://ge.globo.com/agenda' }],
    });
    expect(body.options[0].last_verified_at).toMatch(/-03:00$/);
    expect(body.to_confirm).toEqual([]);
    expect(body.options[0]).toHaveProperty('logo');
    expect(res.headers['surrogate-key']).toContain(`where_to_watch:${eventId}`);
    expect(res.headers['cache-control']).toContain('s-maxage=60');
  });

  it('sem informação confiável: status unknown + mensagem localizada', async () => {
    const pt = (await get(`/v1/events/${eventId}/where-to-watch?country=AR`)).json();
    expect(pt).toMatchObject({
      status: 'unknown',
      options: [],
      message: 'Não temos as informações de transmissão ainda.',
    });
    const es = (await get(`/v1/events/${eventId}/where-to-watch?country=AR&locale=es-AR`)).json();
    expect(es.message).toBe('Todavía no tenemos la información de transmisión.');
  });

  it('plano, mercado, parâmetros e evento inexistente', async () => {
    expect((await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keyNoModule)).json().code).toBe(
      'MODULE_NOT_IN_PLAN',
    );
    expect((await get(`/v1/events/${eventId}/where-to-watch?country=BR`, keyArOnly)).json().code).toBe(
      'MARKET_NOT_IN_PLAN',
    );
    expect((await get(`/v1/events/${eventId}/where-to-watch`)).statusCode).toBe(400);
    expect((await get(`/v1/events/nao-e-uuid/where-to-watch?country=BR`)).statusCode).toBe(400);
    expect(
      (await get(`/v1/events/0192c7e2-0000-7000-8000-000000000000/where-to-watch?country=BR`)).json().code,
    ).toBe('NOT_FOUND');
  });
});

describe('GET /v1/broadcasters', () => {
  it('lista a biblioteca (filtro por país), com logo de origem conhecida e canais por mercado', async () => {
    await syncBroadcasterLibrary(db, config);
    const res = await get('/v1/broadcasters?country=br');
    expect(res.statusCode).toBe(200);
    const data = res.json().data as {
      id: string;
      kind: string;
      countries: string[];
      logo: { url: string; source_url: string; license: string | null } | null;
      markets: { country: string; channels: string[] }[];
    }[];
    expect(data.every((b) => b.countries.includes('BR'))).toBe(true);
    const espn = data.find((b) => b.id === 'espn')!;
    expect(espn.kind).toBe('pay_tv');
    expect(espn.logo).toMatchObject({
      url: expect.stringMatching(/^https:\/\//),
      license: expect.any(String),
    });
    expect(espn.markets.find((m) => m.country === 'BR')!.channels).toContain('ESPN 2');
    expect(data.some((b) => b.logo === null)).toBe(true);
  });

  it('detalhe, 404 e plano sem o módulo', async () => {
    expect((await get('/v1/broadcasters/espn')).json()).toMatchObject({ id: 'espn', name: 'ESPN' });
    expect((await get('/v1/broadcasters/nao_existe')).json().code).toBe('NOT_FOUND');
    expect((await get('/v1/broadcasters', keyNoModule)).json().code).toBe('MODULE_NOT_IN_PLAN');
  });
});

describe('rotas internas (correção editorial)', () => {
  it('exigem chave administrativa e handle do editor (sem e-mail)', async () => {
    const url = `/internal/where-to-watch/events/${eventId}?country=BR`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { 'x-galaxie-admin-key': 'errada', 'x-galaxie-actor': 'ana' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { ...adminHeaders, 'x-galaxie-actor': 'ana@exemplo.com' },
        })
      ).statusCode,
    ).toBe(400);
    const ok = await app.inject({ method: 'GET', url, headers: adminHeaders });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().options).toHaveLength(2);
    expect(ok.headers['cache-control']).toBe('no-store');
    const noKeyApp = buildServer({ db, keyPrefix });
    expect((await noKeyApp.inject({ method: 'GET', url, headers: adminHeaders })).statusCode).toBe(503);
    await noKeyApp.close();
  });

  it('remoção propaga ao cliente em ≤ 5 min (purge via change feed), com trilha de auditoria', async () => {
    const url = `/v1/events/${eventId}/where-to-watch?country=BR`;
    expect((await get(url)).headers['x-galaxie-cache']).toBeDefined();
    const cached = await get(url);
    expect(cached.headers['x-galaxie-cache']).toBe('HIT');
    const globo = cached.json().options.find((o: { provider_id: string }) => o.provider_id === 'globo');

    const t0 = Date.now();
    const del = await app.inject({
      method: 'DELETE',
      url: `/internal/where-to-watch/options/${globo.id}`,
      headers: adminHeaders,
      payload: {
        reason: 'jogo não será exibido na TV aberta',
        reported_at: new Date(t0 - 60_000).toISOString(),
      },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({
      option: { status: 'retracted', produced_by: 'editorial:editor.ana' },
    });

    await expect
      .poll(async () => (await get(url)).json().options.map((o: { provider_id: string }) => o.provider_id), {
        timeout: 10_000,
        interval: 50,
      })
      .toEqual(['disney_plus']);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5 * 60_000); // SLA do contrato
    expect(elapsed).toBeLessThan(10_000); // na prática: segundos
    expect(cdn.purged.flat()).toContain(`where_to_watch:${eventId}`);

    // versão antiga não aceita nova correção
    const stale = await app.inject({
      method: 'PATCH',
      url: `/internal/where-to-watch/options/${globo.id}`,
      headers: adminHeaders,
      payload: { channel: 'x', reason: 'teste de conflito' },
    });
    expect(stale.json().code).toBe('CONFLICT');
  });

  it('inclusão e correção aparecem na API; blocklist é recusada', async () => {
    const url = `/v1/events/${eventId}/where-to-watch?country=BR&region=RS`;
    const add = await app.inject({
      method: 'POST',
      url: `/internal/where-to-watch/events/${eventId}/options`,
      headers: adminHeaders,
      payload: {
        country: 'BR',
        region: 'RS',
        provider: 'Globo',
        provider_id: 'globo',
        channel: 'RBS TV',
        medium: 'free_tv',
        access_model: 'free',
        evidence: [{ url: 'https://ge.globo.com/rs/agenda', excerpt: 'RBS TV transmite para o RS' }],
        reason: 'afiliada confirmou',
      },
    });
    expect(add.statusCode).toBe(201);
    const optionId = add.json().option.id;
    await expect
      .poll(async () => (await get(url)).json().options.map((o: { channel: string | null }) => o.channel), {
        timeout: 10_000,
        interval: 50,
      })
      .toEqual(['RBS TV', null]);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/internal/where-to-watch/options/${optionId}`,
      headers: adminHeaders,
      payload: { channel: 'RBS TV Porto Alegre', reason: 'praça específica' },
    });
    expect(patch.statusCode).toBe(200);
    await expect
      .poll(async () => (await get(url)).json().options[0].channel, { timeout: 10_000, interval: 50 })
      .toBe('RBS TV Porto Alegre');

    const blocked = await app.inject({
      method: 'POST',
      url: `/internal/where-to-watch/events/${eventId}/options`,
      headers: adminHeaders,
      payload: {
        country: 'BR',
        provider: 'Operadora Bloqueada',
        medium: 'pay_tv',
        access_model: 'subscription',
        reason: 'teste',
      },
    });
    expect(blocked.statusCode).toBe(400);

    const state = await app.inject({
      method: 'GET',
      url: `/internal/where-to-watch/events/${eventId}?country=BR&history=true`,
      headers: adminHeaders,
    });
    expect(state.json().corrections.map((c: { action: string }) => c.action)).toEqual([
      'correct',
      'add',
      'remove',
    ]);
    expect(state.json().history.length).toBeGreaterThanOrEqual(5);
  });

  it('reprocessamento entra na fila; métricas em JSON e Prometheus', async () => {
    const rerun = await app.inject({
      method: 'POST',
      url: `/internal/where-to-watch/events/${eventId}/rerun`,
      headers: adminHeaders,
      payload: { country: 'BR', reason: 'cliente reportou erro' },
    });
    expect(rerun.statusCode).toBe(202);
    expect(rerun.json().status).toBe('queued');

    const json = await app.inject({
      method: 'GET',
      url: '/internal/where-to-watch/metrics?countries=BR',
      headers: adminHeaders,
    });
    expect(json.json()).toMatchObject({ countries: ['BR'], correction: { count: 1 } });
    const prom = await app.inject({
      method: 'GET',
      url: '/internal/where-to-watch/metrics?format=prometheus',
      headers: adminHeaders,
    });
    expect(prom.headers['content-type']).toContain('text/plain');
    expect(prom.body).toMatch(/# TYPE galaxie_wtw_options gauge/);
    expect(prom.body).toMatch(/galaxie_wtw_correction_seconds\{stat="max"\} \d+/);
  });
});
