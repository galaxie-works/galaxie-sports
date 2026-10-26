/**
 * GET /v1/events/{id}/context (#57): cenário/resumo de IA lido de `enrich.event_context`, módulo
 * live_intelligence, cache purgado por `event.context_published`, e o resumo no detalhe do evento.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeFeed,
  closeDb,
  competition,
  createDb,
  event,
  eventContext,
  eventParticipant,
  participant,
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
const keyPrefix = `gs-ctx-${randomBytes(4).toString('hex')}:`;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let coreKey: string;
let basketKey: string;
let eventId: string;
const cdn = new RecordingCdnPurger();
const KICKOFF = new Date(Date.now() + 2 * 24 * 3_600_000);

const get = (url: string, k = key) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k } });

const fits = { tv: true, mobile: true, web: true };
function contextRow(
  kind: 'scenario' | 'recap',
  locale: string,
  text: string,
  createdAt: Date,
  extra: { reviewStatus?: string; origin?: 'llm' | 'fallback' } = {},
) {
  const origin = extra.origin ?? 'llm';
  return {
    eventId,
    locale,
    kind,
    content: {
      text,
      sentences: [text],
      origin,
      attempts: 1,
      rejected: [],
      factsHash: 'h',
      generatedAt: createdAt.toISOString(),
      fits,
      run: {
        id: 'r',
        llmCalls: 1,
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: 'm',
        errors: [],
      },
      data: {},
    },
    sources: [
      { kind: 'core', ref: 'core.event' },
      { kind: 'rules', ref: 'regulamento', url: 'https://example.org/regulamento.pdf' },
    ],
    model: origin === 'llm' ? 'fake-standard' : 'template:scenario-rules-labels@v1',
    confidence: origin === 'llm' ? '0.90' : '1.00',
    reviewStatus: extra.reviewStatus ?? 'auto',
    createdAt,
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
      { sport: 'football', kind: 'club', name: 'Corinthians' },
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

  const t0 = new Date(Date.now() - 3 * 3_600_000);
  const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);
  await db.insert(eventContext).values([
    contextRow('scenario', 'pt-BR', 'Palmeiras: avança com empate.', t0, { origin: 'fallback' }),
    contextRow('scenario', 'pt-BR', 'O Palmeiras avança com qualquer empate.', later(1)),
    // revisão editorial rejeitou a geração mais nova: continua valendo a anterior
    contextRow('scenario', 'pt-BR', 'Texto reprovado na revisão.', later(2), { reviewStatus: 'rejected' }),
    contextRow('scenario', 'es-AR', 'Palmeiras avanza con el empate.', later(1), {
      reviewStatus: 'reviewed',
    }),
  ]);

  const t = await upsertTenant(db, { slug: 'li', name: 'LI', plan: 'live_intelligence' });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  const core = await upsertTenant(db, { slug: 'core', name: 'Core', plan: 'core_data' });
  coreKey = (await createApiKey(db, core.id, { env: 'test' })).key;
  const basket = await upsertTenant(db, {
    slug: 'basket',
    name: 'Basquete',
    plan: 'enterprise',
    sports: ['basketball'],
  });
  basketKey = (await createApiKey(db, basket.id, { env: 'test' })).key;

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

describe('GET /v1/events/{id}/context', () => {
  it('devolve a versão vigente por tipo no locale, com fontes, ignorando a rejeitada', async () => {
    const res = await get(`/v1/events/${eventId}/context?tz=America/Sao_Paulo`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-language']).toBe('pt-BR');
    expect(res.headers['surrogate-key']).toContain(`event_context:${eventId}`);
    expect(res.headers['cache-control']).toContain('s-maxage=3600');
    const body = res.json();
    expect(body).toMatchObject({ event_id: eventId, locale: 'pt-BR' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      kind: 'scenario',
      locale: 'pt-BR',
      text: 'O Palmeiras avança com qualquer empate.',
      sentences: ['O Palmeiras avança com qualquer empate.'],
      origin: 'llm',
      model: 'fake-standard',
      confidence: 0.9,
      review_status: 'auto',
      fits: { tv: true, mobile: true, web: true },
      sources: [
        { kind: 'core', ref: 'core.event', url: null },
        { kind: 'rules', ref: 'regulamento', url: 'https://example.org/regulamento.pdf' },
      ],
    });
    expect(body.data[0].generated_at).toMatch(/-03:00$/);
  });

  it('locale e filtro por tipo', async () => {
    const es = (await get(`/v1/events/${eventId}/context?locale=es-AR`)).json();
    expect(es.data.map((d: { text: string; review_status: string }) => [d.text, d.review_status])).toEqual([
      ['Palmeiras avanza con el empate.', 'reviewed'],
    ]);
    // sem fallback entre locales: nada gerado para es-MX
    expect((await get(`/v1/events/${eventId}/context?locale=es-MX`)).json().data).toEqual([]);
    expect((await get(`/v1/events/${eventId}/context?kind=recap`)).json().data).toEqual([]);
    expect((await get(`/v1/events/${eventId}/context?kind=scenario`)).json().data).toHaveLength(1);
  });

  it('plano, esporte, parâmetros e evento inexistente', async () => {
    const noModule = await get(`/v1/events/${eventId}/context`, coreKey);
    expect(noModule.statusCode).toBe(403);
    expect(noModule.json().code).toBe('MODULE_NOT_IN_PLAN');
    // esporte fora do plano, inclusive com a resposta já em cache
    const otherSport = await get(`/v1/events/${eventId}/context`, basketKey);
    expect(otherSport.statusCode).toBe(403);
    expect((await get(`/v1/events/${eventId}/context?kind=preview`)).statusCode).toBe(400);
    expect((await get(`/v1/events/not-a-uuid/context`)).statusCode).toBe(400);
    const missing = await get(`/v1/events/00000000-0000-7000-8000-000000000000/context`);
    expect(missing.statusCode).toBe(404);
  });

  it('nova geração publica event.context_published e purga o cache em segundos', async () => {
    const url = `/v1/events/${eventId}/context?kind=recap`;
    await get(url);
    expect((await get(url)).headers['x-galaxie-cache']).toBe('HIT');
    const t0 = Date.now();
    await db
      .insert(eventContext)
      .values(contextRow('recap', 'pt-BR', 'Fim de jogo: Palmeiras 2 x 0 Corinthians.', new Date()));
    await expect
      .poll(async () => (await get(url)).json().data.map((d: { text: string }) => d.text), {
        timeout: 10_000,
        interval: 50,
      })
      .toEqual(['Fim de jogo: Palmeiras 2 x 0 Corinthians.']);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(cdn.purged.flat()).toContain(`event_context:${eventId}`);
  });
});

describe('GET /v1/events/{id} — resumo do contexto', () => {
  it('traz `context` para live_intelligence e omite para core_data', async () => {
    const withCtx = (await get(`/v1/events/${eventId}`)).json();
    expect(withCtx.context).toMatchObject({
      scenario: { text: 'O Palmeiras avança com qualquer empate.', origin: 'llm' },
      recap: { text: 'Fim de jogo: Palmeiras 2 x 0 Corinthians.', origin: 'llm' },
    });
    const es = (await get(`/v1/events/${eventId}?locale=es-AR`)).json();
    expect(es.context).toMatchObject({ scenario: { text: 'Palmeiras avanza con el empate.' }, recap: null });
    const plain = await get(`/v1/events/${eventId}`, coreKey);
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).not.toHaveProperty('context');
  });
});

describe('rejeição de um texto no ar', () => {
  it('rejeitar o contexto publicado purga o cache (tópico interno, sem SSE/webhook)', async () => {
    const url = `/v1/events/${eventId}/context?kind=recap`;
    expect((await get(url)).json().data).toHaveLength(1);
    expect((await get(url)).headers['x-galaxie-cache']).toBe('HIT');
    await db
      .update(eventContext)
      .set({ reviewStatus: 'rejected' })
      .where(and(eq(eventContext.eventId, eventId), eq(eventContext.kind, 'recap')));
    await expect
      .poll(async () => (await get(url)).json().data, { timeout: 10_000, interval: 50 })
      .toEqual([]);
    const [change] = await db
      .select({ topic: changeFeed.topic, entityId: changeFeed.entityId })
      .from(changeFeed)
      .orderBy(desc(changeFeed.id))
      .limit(1);
    expect(change).toEqual({ topic: 'event_context.rejected', entityId: eventId });
    // o resumo no detalhe do evento também sai sem o texto rejeitado
    expect((await get(`/v1/events/${eventId}`)).json().context.recap).toBeNull();
  });
});
