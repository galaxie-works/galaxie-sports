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
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  participant,
  publishChange,
  RELATED_CONTENT_TOPIC,
  relatedContent,
  relatedContentTag,
  runMigrations,
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
    row('short1', { contentType: 'goal', format: 'short', durationSeconds: 40, rankScore: '5.500' }),
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

  // a migração 0011 dá o módulo aos tenants enterprise; upsertTenant usa os módulos do plano
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
    expect(shorts.data[0]).toMatchObject({ format: 'short', content_type_label: 'Gol' });
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
});
