/**
 * GET /v1/events/{id}/related (#127): vídeos relacionados lidos de `enrich.related_content`, módulo
 * add-on related_content, filtros por tipo/formato, contagens por tipo e purge por
 * `event.related_content_changed`.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clearRelatedChannelRefusals,
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  listRelatedChannels,
  participant,
  publishChange,
  RELATED_CONTENT_TOPIC,
  relatedChannelRule,
  relatedContent,
  relatedContentTag,
  runMigrations,
  setRelatedChannelRule,
  sport,
  type Database,
} from '@galaxie/db';
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
const keyPrefix = `gs-rel-${randomBytes(4).toString('hex')}:`;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let liKey: string;
let eventId: string;
const cdn = new RecordingCdnPurger();
const KICKOFF = new Date('2026-10-22T00:30:00Z');

const get = (url: string, k = key) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k } });
const reportError = (body: Record<string, unknown>, k = key) =>
  app.inject({
    method: 'POST',
    url: '/v1/related/playback-errors',
    headers: { 'x-galaxie-key': k },
    payload: body,
  });

type Row = typeof relatedContent.$inferInsert;
function row(externalId: string, over: Partial<Row> = {}): Row {
  return {
    eventId,
    provider: 'youtube',
    externalId,
    url: `https://www.youtube.com/watch?v=${externalId}`,
    embedUrl: `https://www.youtube.com/embed/${externalId}`,
    title: `Vídeo ${externalId}`,
    channelId: 'UCpal',
    channelTitle: 'Palmeiras',
    channelHandle: '@palmeiras',
    sourceTier: 'official',
    contentType: 'highlights',
    format: 'long',
    aspectRatio: '16:9',
    durationSeconds: 600,
    publishedAt: new Date('2026-10-22T03:00:00Z'),
    thumbnailUrl: `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
    language: 'pt',
    statistics: { views: 1000, likes: null, comments: null, fetchedAt: '2026-10-22T09:00:00Z' },
    rankScore: '5.000',
    confidence: '0.90',
    classifiedBy: 'llm:fake-light',
    status: 'published',
    lastCheckedAt: new Date('2026-10-22T09:00:00Z'),
    ...over,
  };
}

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
      status: 'finished',
    })
    .returning();
  eventId = ev!.id;
  await db.insert(eventParticipant).values([
    { eventId, participantId: home!.id, side: 'home' },
    { eventId, participantId: away!.id, side: 'away' },
  ]);
  await db.insert(relatedContent).values([
    row('hl', { rankScore: '6.000' }),
    row('short1', {
      contentType: 'goal',
      format: 'short',
      aspectRatio: '9:16',
      durationSeconds: 40,
      rankScore: '5.500',
    }),
    row('coletiva', { contentType: 'press_conference', durationSeconds: 1800, rankScore: '4.000' }),
    row('react', {
      contentType: 'fan_reaction',
      sourceTier: 'creator',
      channelHandle: null,
      rankScore: '2.000',
    }),
    // não aparecem: pendente, rejeitado e versão aposentada
    row('pend', { status: 'pending', contentType: 'highlights' }),
    row('rej', { status: 'rejected', contentType: 'goal', flags: ['rights_risk'] }),
    row('old', { supersededBy: '00000000-0000-7000-8000-000000000001', supersededAt: new Date() }),
  ]);

  // a migração 0014 dá o módulo aos tenants enterprise; upsertTenant usa os módulos do plano
  const ent = await upsertTenant(db, { slug: 'ent', name: 'Ent', plan: 'enterprise' });
  key = (await createApiKey(db, ent.id, { env: 'test' })).key;
  const li = await upsertTenant(db, { slug: 'li', name: 'LI', plan: 'live_intelligence' });
  liKey = (await createApiKey(db, li.id, { env: 'test' })).key;

  app = buildServer({ db, redis, keyPrefix, cdnPurger: cdn, changeFeed: { pollIntervalMs: 250 } });
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

describe('GET /v1/events/{id}/related', () => {
  it('só publicados e vigentes, por ranking, com links diretos, canal e contagens por tipo', async () => {
    const res = await get(`/v1/events/${eventId}/related?tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['surrogate-key']).toContain(relatedContentTag(eventId));
    expect(res.headers['cache-control']).toContain('s-maxage=3600');
    const body = res.json();
    expect(body.data.map((d: { external_id: string }) => d.external_id)).toEqual([
      'hl',
      'short1',
      'coletiva',
      'react',
    ]);
    expect(body.data[0]).toMatchObject({
      provider: 'youtube',
      url: 'https://www.youtube.com/watch?v=hl',
      embed_url: 'https://www.youtube.com/embed/hl',
      content_type: 'highlights',
      content_type_label: 'Melhores momentos',
      format: 'long',
      aspect_ratio: '16:9',
      duration_seconds: 600,
      thumbnail_url: 'https://i.ytimg.com/vi/hl/hqdefault.jpg',
      channel: { id: 'UCpal', title: 'Palmeiras', handle: '@palmeiras', source_tier: 'official' },
      views: 1000,
      confidence: 0.9,
      classified_by: 'llm:fake-light',
    });
    expect(body.data[0].published_at).toBe('2026-10-22T00:00:00-03:00');
    expect(body.counts).toEqual({ highlights: 1, goal: 1, press_conference: 1, fan_reaction: 1 });
    expect(body.updated_at).toBe('2026-10-22T06:00:00-03:00');
  });

  it('filtros por tipo e formato, locale do rótulo e limite', async () => {
    const goals = (await get(`/v1/events/${eventId}/related?type=goal,press_conference`)).json();
    expect(goals.data.map((d: { external_id: string }) => d.external_id)).toEqual(['short1', 'coletiva']);
    expect(goals.counts.highlights).toBe(1); // contagens antes do filtro
    const shorts = (await get(`/v1/events/${eventId}/related?format=short&locale=es-AR`)).json();
    expect(shorts.data).toHaveLength(1);
    expect(shorts.data[0]).toMatchObject({
      format: 'short',
      aspect_ratio: '9:16',
      content_type_label: 'Gol',
    });
    const es = (await get(`/v1/events/${eventId}/related?type=fan_reaction&locale=es-MX`)).json();
    expect(es.data[0].content_type_label).toBe('Reacción de la hinchada');
    expect((await get(`/v1/events/${eventId}/related?limit=2`)).json().data).toHaveLength(2);
  });

  it('módulo, parâmetros e evento inexistente', async () => {
    const noModule = await get(`/v1/events/${eventId}/related`, liKey);
    expect(noModule.statusCode).toBe(403);
    expect(noModule.json().code).toBe('MODULE_NOT_IN_PLAN');
    expect((await get(`/v1/events/${eventId}/related?type=gols`)).statusCode).toBe(400);
    expect((await get(`/v1/events/${eventId}/related?format=vertical`)).statusCode).toBe(400);
    expect((await get(`/v1/events/${eventId}/related?limit=500`)).statusCode).toBe(400);
    expect((await get(`/v1/events/00000000-0000-7000-8000-000000000000/related`)).statusCode).toBe(404);
  });

  it('event.related_content_changed purga o cache', async () => {
    const url = `/v1/events/${eventId}/related?type=behind_the_scenes`;
    expect((await get(url)).json().data).toEqual([]);
    expect((await get(url)).headers['x-galaxie-cache']).toBe('HIT');
    await db.transaction(async (tx) => {
      await tx.insert(relatedContent).values(row('bast', { contentType: 'behind_the_scenes' }));
      await publishChange(tx, {
        topic: RELATED_CONTENT_TOPIC,
        entityType: 'related_content',
        entityId: eventId,
        payload: { event_id: eventId, tags: [relatedContentTag(eventId), `event:${eventId}`] },
      });
    });
    await expect
      .poll(async () => (await get(url)).json().data.map((d: { external_id: string }) => d.external_id), {
        timeout: 10_000,
        interval: 50,
      })
      .toEqual(['bast']);
    expect(cdn.purged.flat()).toContain(relatedContentTag(eventId));
  });

  it('localizado por país: só o idioma do público, o próprio país primeiro, nunca vídeo em português para AR', async () => {
    await db
      .insert(relatedContent)
      .values([
        row('an-br', { contentType: 'analysis', language: 'pt-BR', rankScore: '9.000' }),
        row('an-mx', { contentType: 'analysis', language: 'es-MX', rankScore: '8.000' }),
        row('an-ar', { contentType: 'analysis', language: 'es-AR', rankScore: '1.000' }),
        row('an-xx', { contentType: 'analysis', language: null, rankScore: '9.500' }),
      ]);
    const ids = async (qs: string) =>
      (await get(`/v1/events/${eventId}/related?type=analysis&${qs}`))
        .json()
        .data.map((d: { external_id: string }) => d.external_id);
    // a Argentina vê os argentinos primeiro, depois o mesmo idioma de outro país; nada em português
    expect(await ids('country=ar')).toEqual(['an-ar', 'an-mx']);
    expect(await ids('country=BR')).toEqual(['an-br']);
    // fora dos países lusófonos e hispânicos, sem filtro; sem país, todos (como antes)
    expect(await ids('country=US')).toEqual(['an-xx', 'an-br', 'an-mx', 'an-ar']);
    expect(await ids('')).toEqual(['an-xx', 'an-br', 'an-mx', 'an-ar']);
    expect((await get(`/v1/events/${eventId}/related?country=ARG`)).statusCode).toBe(400);
  });

  it('filtro por proporção: só verticais, só horizontais ou os dois', async () => {
    const ids = async (qs: string) =>
      (await get(`/v1/events/${eventId}/related?type=highlights,goal&${qs}`))
        .json()
        .data.map((d: { external_id: string }) => d.external_id);
    expect(await ids('aspect_ratio=9:16')).toEqual(['short1']);
    expect(await ids('aspect_ratio=16:9')).toEqual(['hl']);
    expect(await ids('aspect_ratio=16:9,9:16')).toEqual(['hl', 'short1']);
    expect((await get(`/v1/events/${eventId}/related?aspect_ratio=21:9`)).statusCode).toBe(400);
  });

  it('restrição de país do YouTube: o vídeo bloqueado no país não aparece para ele', async () => {
    await db
      .insert(relatedContent)
      .values([
        row('bts-noar', { contentType: 'behind_the_scenes', language: 'es-AR', regionBlocked: ['AR'] }),
        row('bts-onlymx', { contentType: 'behind_the_scenes', language: 'es-MX', regionAllowed: ['MX'] }),
        row('bts-all', { contentType: 'behind_the_scenes', language: 'es-AR', rankScore: '1.000' }),
      ]);
    const ids = async (country: string) =>
      (await get(`/v1/events/${eventId}/related?type=behind_the_scenes&country=${country}`))
        .json()
        .data.map((d: { external_id: string }) => d.external_id);
    expect(await ids('AR')).toEqual(['bts-all']);
    // o bloqueado só na Argentina toca no México
    expect(await ids('MX')).toEqual(['bts-onlymx', 'bts-noar', 'bts-all']);
  });

  it('erro do player tira o vídeo da vitrine; 3 recusas tiram o canal, e a liberação no painel vence', async () => {
    await db.insert(relatedContent).values([
      row('cz1', {
        contentType: 'full_match',
        channelId: 'UCcz',
        channelTitle: 'Canal X',
        rankScore: '3.000',
      }),
      row('cz2', {
        contentType: 'full_match',
        channelId: 'UCcz',
        channelTitle: 'Canal X',
        rankScore: '2.900',
      }),
      row('cz3', {
        contentType: 'full_match',
        channelId: 'UCcz',
        channelTitle: 'Canal X',
        rankScore: '2.800',
      }),
      row('cz4', {
        contentType: 'full_match',
        channelId: 'UCcz',
        channelTitle: 'Canal X',
        rankScore: '2.700',
      }),
    ]);
    const url = `/v1/events/${eventId}/related?type=full_match`;
    const ids = async () => (await get(url)).json().data.map((d: { external_id: string }) => d.external_id);
    expect(await ids()).toEqual(['cz1', 'cz2', 'cz3', 'cz4']);
    const items = (await get(url)).json().data as { id: string; external_id: string }[];
    const idOf = (ext: string) => items.find((i) => i.external_id === ext)!.id;

    const first = await reportError({ item_id: idOf('cz1'), code: 150 });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ external_id: 'cz1', removed_from_events: 1 });
    // o change feed purga o cache do jogo
    await expect.poll(ids, { timeout: 10_000, interval: 50 }).toEqual(['cz2', 'cz3', 'cz4']);
    // relato repetido só soma
    expect((await reportError({ item_id: idOf('cz1'), code: 150 })).json().removed_from_events).toBe(0);

    await reportError({ item_id: idOf('cz2'), code: 101 });
    await reportError({ item_id: idOf('cz3'), code: 150 });
    // terceira recusa do canal: o cz4, que nunca falhou, também sai
    await expect.poll(ids, { timeout: 10_000, interval: 50 }).toEqual([]);

    // liberado no painel: volta o que não foi recusado
    await db.insert(relatedChannelRule).values({ provider: 'youtube', channelId: 'UCcz', mode: 'allow' });
    await db.transaction((tx) =>
      publishChange(tx, {
        topic: RELATED_CONTENT_TOPIC,
        entityType: 'related_content',
        entityId: eventId,
        payload: { event_id: eventId, tags: [relatedContentTag(eventId)] },
      }),
    );
    await expect.poll(ids, { timeout: 10_000, interval: 50 }).toEqual(['cz4']);
  });

  it('relato de erro: código, item, chave e módulo', async () => {
    const any = (await get(`/v1/events/${eventId}/related`)).json().data[0].id as string;
    expect((await reportError({ item_id: any, code: 5 })).statusCode).toBe(400);
    expect((await reportError({ item_id: 'x', code: 150 })).statusCode).toBe(400);
    expect(
      (await reportError({ item_id: '00000000-0000-7000-8000-000000000000', code: 150 })).statusCode,
    ).toBe(404);
    expect((await reportError({ item_id: any, code: 150 }, liKey)).statusCode).toBe(403);
  });

  it('painel: lista os canais com recusas e regra; bloquear, voltar ao automático e limpar recusas', async () => {
    await db
      .insert(relatedContent)
      .values(
        row('pn1', {
          contentType: 'interview',
          channelId: 'UCpn',
          channelTitle: 'Canal Painel',
          rankScore: '1.000',
        }),
      );
    const url = `/v1/events/${eventId}/related?type=interview`;
    const ids = async () => (await get(url)).json().data.map((d: { external_id: string }) => d.external_id);
    expect(await ids()).toEqual(['pn1']);

    const before = await listRelatedChannels(db, { q: 'painel' });
    expect(before).toEqual([
      expect.objectContaining({
        channelId: 'UCpn',
        title: 'Canal Painel',
        published: 1,
        refused: 0,
        blocked: false,
      }),
    ]);
    // o canal X (3 recusas, liberado no teste anterior) aparece no filtro de recusas
    const refused = await listRelatedChannels(db, { only: 'refused' });
    expect(refused.map((c) => c.channelId)).toContain('UCcz');
    expect(refused.find((c) => c.channelId === 'UCcz')).toMatchObject({
      refused: 3,
      rule: 'allow',
      blocked: false,
    });

    expect(
      await setRelatedChannelRule(db, { channelId: 'UCpn', mode: 'block', by: 'admin@galaxie.test' }),
    ).toBe(1);
    await expect.poll(ids, { timeout: 10_000, interval: 50 }).toEqual([]);
    expect((await listRelatedChannels(db, { only: 'blocked' })).map((c) => c.channelId)).toContain('UCpn');

    await setRelatedChannelRule(db, { channelId: 'UCpn', mode: null, by: 'admin@galaxie.test' });
    await expect.poll(ids, { timeout: 10_000, interval: 50 }).toEqual(['pn1']);

    // limpar as recusas do canal X traz de volta os vídeos recusados
    await setRelatedChannelRule(db, { channelId: 'UCcz', mode: null, by: 'admin@galaxie.test' });
    expect(await clearRelatedChannelRefusals(db, { channelId: 'UCcz' })).toBe(3);
    await expect
      .poll(
        async () =>
          (await get(`/v1/events/${eventId}/related?type=full_match`))
            .json()
            .data.map((d: { external_id: string }) => d.external_id),
        { timeout: 10_000, interval: 50 },
      )
      .toEqual(['cz1', 'cz2', 'cz3', 'cz4']);
  });
});
