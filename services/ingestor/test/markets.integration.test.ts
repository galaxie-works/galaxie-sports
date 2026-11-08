import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiResponse,
  bookmaker,
  country,
  eventOdds,
  eventPrediction,
  providerMap,
  sport,
  type Database,
  type OddsMarket,
} from '@galaxie/db';
import { normalizeFixtures, type ApiFixture } from '@galaxie/providers';
import { upsertBatch } from '@galaxie/core-writer';
import { normalizeAfterFetch } from '../src/normalize/after-fetch.js';
import { normalizeMarketsFromRaw } from '../src/normalize/markets.js';
import { disposableDb } from './db.js';

const FIXTURES = new URL('../../../packages/providers/test/fixtures/api-sports/football/', import.meta.url);
const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;

const GAME = 1492407;
const fixture = load<{ response: ApiFixture[] }>('fixtures-id-1492407.json');
/** Palpite e odds de exemplo, apontados para o jogo do fixture (Palmeiras 121 × Corinthians 131). */
const predictions = load<{ response: Record<string, unknown>[] }>('predictions-fixture-1001.json');
const oddsBody = (() => {
  const o = load<{ response: Record<string, unknown>[] }>('odds-fixture-1001.json');
  o.response[0]!.fixture = { id: GAME };
  return o;
})();

const tdb = disposableDb();
let db: Database;
let eventId: string;
let palmeiras: string;

beforeAll(async () => {
  db = await tdb.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values({ code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil' } });
  await upsertBatch(db, normalizeFixtures(fixture.response, new Date('2026-10-12T00:00:00Z')));
  const ids = await db
    .select({ type: providerMap.entityType, pid: providerMap.providerId, id: providerMap.entityId })
    .from(providerMap);
  eventId = ids.find((r) => r.type === 'event' && r.pid === String(GAME))!.id;
  palmeiras = ids.find((r) => r.type === 'participant' && r.pid === '121')!.id;
}, 60_000);

afterAll(async () => {
  await tdb.teardown();
});

const request = (endpoint: string, params: Record<string, string>, fetchedAt: string) => ({
  step: 'teste',
  sport: 'football' as const,
  endpoint,
  params,
  cursors: [],
  source: 'network' as const,
  requestHash: `${endpoint}-${fetchedAt}`,
  fetchedAt: new Date(fetchedAt),
});

describe('palpites e odds pelo afterFetch', () => {
  it('grava o palpite no jogo e no time pelos nossos IDs', async () => {
    const n = normalizeAfterFetch(db);
    await n.afterFetch(
      predictions as never,
      request('/predictions', { fixture: String(GAME) }, '2026-10-11T10:00:00Z') as never,
    );
    expect(n.report()).toMatchObject({ normalized: 1, errors: 0, markets: { predictions: 1 } });
    const [row] = await db.select().from(eventPrediction).where(eq(eventPrediction.eventId, eventId));
    expect(row).toMatchObject({
      winnerParticipantId: palmeiras,
      winOrDraw: true,
      probHome: 45,
      probDraw: 45,
      probAway: 10,
      goals: { total: { side: 'under', line: 3.5 } },
      advice: expect.stringContaining('Double chance'),
    });
    expect(row!.comparison).toMatchObject({ total: { home: 55.7, away: 44.3 } });
  });

  it('regravar o mesmo palpite não muda nada; um palpite mais velho não sobrescreve', async () => {
    const n = normalizeAfterFetch(db);
    await n.afterFetch(
      predictions as never,
      request('/predictions', { fixture: String(GAME) }, '2026-10-11T10:00:00Z') as never,
    );
    const older = structuredClone(predictions);
    (older.response[0]!.predictions as { percent: unknown }).percent = {
      home: '10%',
      draw: '10%',
      away: '80%',
    };
    await n.afterFetch(
      older as never,
      request('/predictions', { fixture: String(GAME) }, '2026-10-10T10:00:00Z') as never,
    );
    expect(n.report().markets.predictions).toBe(0);
    const [row] = await db.select().from(eventPrediction).where(eq(eventPrediction.eventId, eventId));
    expect(row!.probAway).toBe(10);
  });

  it('resposta vazia mantém o último palpite; jogo fora do core não quebra', async () => {
    const n = normalizeAfterFetch(db);
    await n.afterFetch(
      { response: [] } as never,
      request('/predictions', { fixture: String(GAME) }, '2026-10-11T12:00:00Z') as never,
    );
    await n.afterFetch(
      predictions as never,
      request('/predictions', { fixture: '999999' }, '2026-10-11T12:00:00Z') as never,
    );
    expect(n.report()).toMatchObject({ empty: 1, errors: 0, markets: { missingEvent: 1 } });
    expect(await db.select().from(eventPrediction)).toHaveLength(1);
  });

  it('grava as odds por casa e cria as casas pelo nome', async () => {
    const n = normalizeAfterFetch(db);
    await n.afterFetch(
      oddsBody as never,
      request('/odds', { fixture: String(GAME) }, '2026-10-11T10:00:00Z') as never,
    );
    expect(n.report().markets).toMatchObject({ odds: 2, bookmakersCreated: 2 });
    const books = await db.select().from(bookmaker);
    expect(books.map((b) => b.slug).sort()).toEqual(['casa-dois', 'casa-um']);
    const rows = await db.select().from(eventOdds).where(eq(eventOdds.eventId, eventId));
    expect(rows).toHaveLength(2);
    const casaUm = rows.find((r) => r.bookmakerId === books.find((b) => b.slug === 'casa-um')!.id)!;
    expect((casaUm.markets as OddsMarket[])[0]).toMatchObject({
      key: 'match_winner',
      selections: [{ key: 'home', price: 1.85 }, { key: 'draw' }, { key: 'away' }],
    });
    expect(casaUm.sourceUpdatedAt?.toISOString()).toBe('2026-10-21T09:49:32.000Z');
  });

  it('a foto nova substitui a anterior e tira a casa que sumiu; a velha é ignorada', async () => {
    const next = structuredClone(oddsBody);
    const bks = next.response[0]!.bookmakers as unknown[];
    next.response[0]!.bookmakers = [bks[0]];
    const n = normalizeAfterFetch(db);
    await n.afterFetch(
      next as never,
      request('/odds', { fixture: String(GAME) }, '2026-10-11T13:00:00Z') as never,
    );
    expect(n.report().markets).toMatchObject({ oddsRemoved: 1, bookmakersCreated: 0 });
    expect(await db.select().from(eventOdds).where(eq(eventOdds.eventId, eventId))).toHaveLength(1);

    await n.afterFetch(
      oddsBody as never,
      request('/odds', { fixture: String(GAME) }, '2026-10-11T11:00:00Z') as never,
    );
    expect(n.report().markets.older).toBe(1);
    expect(await db.select().from(eventOdds).where(eq(eventOdds.eventId, eventId))).toHaveLength(1);
  });

  it('a lista de casas usa o provider_map e não duplica pelo nome', async () => {
    const n = normalizeAfterFetch(db);
    await n.afterFetch(
      {
        response: [
          { id: 6, name: 'Casa Um' },
          { id: 30, name: 'Casa Três' },
        ],
      } as never,
      request('/odds/bookmakers', {}, '2026-10-11T14:00:00Z') as never,
    );
    expect(n.report().markets.bookmakersCreated).toBe(1);
    expect((await db.select().from(bookmaker)).map((b) => b.slug).sort()).toEqual([
      'casa-dois',
      'casa-tres',
      'casa-um',
    ]);
  });
});

describe('normalize:markets (reconstrução pelo raw)', () => {
  it('lê a última resposta de cada requisição e grava de novo, sem duplicar', async () => {
    await db.delete(eventPrediction);
    await db.delete(eventOdds);
    const raw = (endpoint: string, params: Record<string, string>, body: unknown, fetchedAt: string) => ({
      sport: 'football',
      apiVersion: 'v3',
      endpoint,
      params,
      requestHash: `${endpoint}?${JSON.stringify(params)}`,
      statusCode: 200,
      results: 1,
      body,
      bodyHash: `${endpoint}-${fetchedAt}`,
      fetchedAt: new Date(fetchedAt),
    });
    await db
      .insert(apiResponse)
      .values([
        raw('/predictions', { fixture: String(GAME) }, predictions, '2026-10-11T15:00:00Z'),
        raw('/odds', { fixture: String(GAME) }, oddsBody, '2026-10-11T15:00:00Z'),
      ]);
    const r = await normalizeMarketsFromRaw(db, 'football');
    expect(r).toMatchObject({ responses: 2, normalized: 2, errors: 0 });
    expect(r.stats).toMatchObject({ predictions: 1, odds: 2, bookmakersCreated: 0 });
    const again = await normalizeMarketsFromRaw(db, 'football');
    expect(again.stats).toMatchObject({ predictions: 0, odds: 0 });
    expect(await db.select().from(eventOdds)).toHaveLength(2);
  });
});
