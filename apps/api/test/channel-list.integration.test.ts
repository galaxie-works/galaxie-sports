/**
 * Lista de canais do cliente ponta a ponta contra o Postgres e o Valkey de desenvolvimento: envio
 * (`PUT /v1/channel-list`), casamento por código, confirmação e os `client_channels` no onde assistir,
 * com o exemplo de referência (Palmeiras × Fluminense) e o caso Globo SP + Globo RJ. Os nomes de
 * canais são de emissoras, não de clientes.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  broadcastOption,
  closeDb,
  competition,
  createDb,
  event,
  getChannelList,
  runMigrations,
  sport,
  type BroadcastMedium,
  type Database,
} from '@galaxie/db';
import { FIXTURE_CHANNELS, FIXTURE_EXPECTED, FIXTURE_RIGHTS, loadWtwConfig } from '@galaxie/where-to-watch';
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
const keyPrefix = `gs-chlist-${randomBytes(4).toString('hex')}:`;
const config = loadWtwConfig({ env: {} });

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let eventId: string;
const keys = { main: '', praca: '', none: '' };
const tenants = { main: '' };

const req = (method: 'GET' | 'PUT' | 'POST', url: string, key: string, payload?: unknown) =>
  app.inject({ method, url, headers: { 'x-galaxie-key': key }, ...(payload ? { payload } : {}) });
const wtw = async (country: string, key: string) => {
  const res = await req('GET', `/v1/events/${eventId}/where-to-watch?country=${country}`, key);
  expect(res.statusCode).toBe(200);
  return res.json() as {
    options: { provider_id: string; client_channels?: { index: number; name: string; match: string }[] }[];
  };
};
const channelsOf = async (country: string, provider: string, key: string) =>
  (await wtw(country, key)).options.find((o) => o.provider_id === provider)?.client_channels;

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
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      startsAt: kickoff,
      endsAtExpected: new Date(kickoff.getTime() + 7_200_000),
    })
    .returning();
  eventId = ev!.id;

  // as opções do jogo nos cinco países são os direitos do exemplo de referência
  await db.insert(broadcastOption).values(
    FIXTURE_RIGHTS.map((r) => {
      const b = config.directory(r.country).byIdOrNull(r.broadcasterId)!;
      return {
        eventId,
        countryCode: r.country,
        providerName: b.name,
        broadcasterId: b.id,
        medium: b.medium as BroadcastMedium,
        accessModel: b.accessModel,
        status: 'confirmed' as const,
        confidence: '0.95',
        evidence: [],
        producedBy: 'editorial:teste',
      };
    }),
  );

  const tenant = async (slug: string) => {
    const t = await upsertTenant(db, { slug, name: slug, plan: 'fan_experience', markets: [] });
    return { id: t.id, key: (await createApiKey(db, t.id, { env: 'test' })).key };
  };
  const main = await tenant('lista-canais-principal');
  const praca = await tenant('lista-canais-pracas');
  const none = await tenant('lista-canais-sem-lista');
  Object.assign(keys, { main: main.key, praca: praca.key, none: none.key });
  tenants.main = main.id;

  app = buildServer({ db, redis, keyPrefix, usage: false, wtwConfig: config });
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

describe('PUT /v1/channel-list', () => {
  it('recusa lista vazia e país fora do onde assistir', async () => {
    expect((await req('PUT', '/v1/channel-list', keys.main, { content: '  \n ' })).statusCode).toBe(400);
    const bad = await req('PUT', '/v1/channel-list', keys.main, { content: 'GLOBO', default_country: 'US' });
    expect(bad.statusCode).toBe(400);
    expect((await req('GET', '/v1/channel-list', keys.main)).statusCode).toBe(404);
  });

  it('grava só os nomes e propõe o casamento do exemplo de referência', async () => {
    const m3u = [
      '#EXTM3U',
      ...FIXTURE_CHANNELS.flatMap((n, i) => [
        `#EXTINF:-1 tvg-id="x${i}",${n}`,
        `http://stream.example/${i}.ts`,
      ]),
    ].join('\n');
    const res = await req('PUT', '/v1/channel-list', keys.main, { content: m3u });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toMatchObject({
      status: 'review',
      source: 'm3u',
      confirmed_matches: null,
      // nenhuma sobra com candidato: SBT, Telefe, TNT, Caracol, Win Sports+ e Azteca casam com as
      // próprias emissoras; os streamings não têm canal na lista. A IA nem é chamada.
      ai_status: 'not_needed',
    });
    expect(body.channels.map((c: { name: string }) => c.name)).toEqual(FIXTURE_CHANNELS);
    expect(JSON.stringify(body)).not.toMatch(/stream\.example|tvg-id/);
    // o universo é o dicionário dos mercados; os direitos do jogo estão nele com o casamento esperado
    const by = new Map(
      body.matches.map((m: { country: string; provider_id: string }) => [`${m.country}:${m.provider_id}`, m]),
    );
    for (const [key, exp] of Object.entries(FIXTURE_EXPECTED)) {
      const m = by.get(key) as { match: string; channels: { index: number }[] };
      expect({ key, match: m.match, channels: m.channels.map((c) => c.index) }).toEqual({ key, ...exp });
    }
    expect((by.get('BR:sbt') as { match: string }).match).toBe('exato');
    expect((by.get('CO:win_sports') as { channels: { index: number }[] }).channels).toEqual([
      { index: 9, name: 'COL: WIN SPORTS+ HD' },
    ]);
    const row = await getChannelList(db, tenants.main);
    expect(row!.channels[0]).toEqual({ idx: 0, name: 'BR: |SP| GLOBO HD', group: null });
  });

  it('antes da confirmação o onde assistir não muda', async () => {
    expect(await channelsOf('BR', 'globo', keys.main)).toBeUndefined();
  });
});

describe('POST /v1/channel-list/confirm → client_channels no onde assistir', () => {
  it('cada emissora com os canais da lista e o tipo de casamento, por país', async () => {
    const res = await req('POST', '/v1/channel-list/confirm', keys.main);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');

    expect(await channelsOf('BR', 'globo', keys.main)).toEqual([
      { index: 0, name: 'BR: |SP| GLOBO HD', match: 'exato' },
    ]);
    expect(await channelsOf('AR', 'fox_sports', keys.main)).toEqual([
      { index: 3, name: 'ARG: FOX SPORTS HD', match: 'exato' },
    ]);
    expect(await channelsOf('CL', 'chilevision', keys.main)).toEqual([
      { index: 4, name: 'CL: CHILEVISION SPORTS', match: 'nome_divergente' },
    ]);
    for (const country of ['CL', 'CO'])
      expect(await channelsOf(country, 'espn', keys.main)).toEqual([
        { index: 5, name: 'ESPN HD', match: 'feed_generico' },
      ]);
    expect(await channelsOf('CL', 'paramount_plus', keys.main)).toEqual([]);
    expect(await channelsOf('CO', 'disney_plus', keys.main)).toEqual([]);
    expect(await channelsOf('MX', 'hbo_max', keys.main)).toEqual([]);
  });

  it('tenant sem lista: a resposta segue sem client_channels', async () => {
    expect(await channelsOf('BR', 'globo', keys.none)).toBeUndefined();
  });

  it('praça não é modelada: Globo SP e Globo RJ entram as duas como exato', async () => {
    await req('PUT', '/v1/channel-list', keys.praca, { content: 'BR: |SP| GLOBO HD\nGLOBO RJ\nESPN HD' });
    await req('POST', '/v1/channel-list/confirm', keys.praca);
    expect(await channelsOf('BR', 'globo', keys.praca)).toEqual([
      { index: 0, name: 'BR: |SP| GLOBO HD', match: 'exato' },
      { index: 1, name: 'GLOBO RJ', match: 'exato' },
    ]);
  });

  it('reprocessar sem mudança mantém a confirmação; lista nova volta para revisão', async () => {
    const same = await req('POST', '/v1/channel-list/reprocess', keys.main);
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ status: 'confirmed' });

    const changed = await req('PUT', '/v1/channel-list', keys.main, { content: 'GLOBO RJ\nESPN HD' });
    expect(changed.json()).toMatchObject({ status: 'review' });
    expect(changed.json().confirmed_matches).not.toBeNull();
    // a API segue com a versão confirmada até a próxima confirmação
    expect(await channelsOf('BR', 'globo', keys.main)).toEqual([
      { index: 0, name: 'BR: |SP| GLOBO HD', match: 'exato' },
    ]);
  });
});
