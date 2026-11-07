import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Envelope } from '@galaxie/apisports-client';
import { providerMap, sport, teamSeasonStat, type Database } from '@galaxie/db';
import { normalizeAfterFetch } from '../src/normalize/after-fetch.js';
import { plannedRequest, type FetchedRequest } from '../src/jobs/runtime/runner.js';
import { fakeTeamStatistics, LEAGUES } from '../src/testing/fake-api.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await testDb.setup();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
}, 60_000);
afterAll(() => testDb.teardown());

const league = LEAGUES.find((l) => l.id === 71)!;
const params = { league: '71', season: '2025', team: '121' };

function envelopeOf(response: unknown): Envelope {
  return {
    get: 'teams/statistics',
    parameters: params,
    errors: [],
    results: 11,
    paging: { current: 1, total: 1 },
    response,
  } as Envelope;
}

function request(fetchedAt: Date): FetchedRequest {
  return {
    ...plannedRequest('teams-statistics', 'football', '/teams/statistics', params),
    source: 'network',
    requestHash: 'h',
    fetchedAt,
  };
}

async function fetchStats(at: string, edit?: (s: ReturnType<typeof fakeTeamStatistics>) => void) {
  const body = fakeTeamStatistics(league, 2025, 121);
  edit?.(body);
  const { afterFetch, report } = normalizeAfterFetch(db);
  await afterFetch(envelopeOf(body), request(new Date(at)));
  return report();
}

async function row() {
  const [team] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.providerId, '121'),
      ),
    );
  const rows = await db.select().from(teamSeasonStat).where(eq(teamSeasonStat.participantId, team!.id));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('estatísticas do time pelo afterFetch (#893)', () => {
  it('teams/statistics vira core.team_season_stat ligado ao time e à temporada pelo provider_map', async () => {
    const r = await fetchStats('2026-11-05T10:00:00Z');
    expect(r).toMatchObject({ normalized: 1, errors: 0 });
    expect(r.stats.teamSeasonStats).toBe(1);
    const saved = await row();
    expect(saved).toMatchObject({ played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 9, goalsAgainst: 4 });
    expect(saved.form).toBe('WLDWW');
    expect(saved.stats).toMatchObject({
      formations: [
        { formation: '4-3-3', played: 4 },
        { formation: '4-4-2', played: 1 },
      ],
    });
  });

  it('a mesma resposta de novo não toca a linha', async () => {
    const before = await row();
    await fetchStats('2026-11-05T10:00:00Z');
    expect((await row()).updatedAt).toEqual(before.updatedAt);
  });

  it('resposta mais antiga que a gravada não volta os números', async () => {
    await fetchStats('2026-11-04T10:00:00Z', (s) => {
      s.fixtures.played = { home: 1, away: 1, total: 2 };
    });
    expect((await row()).played).toBe(5);
  });

  it('coleta mais nova substitui; sem mudança, só avança a data do dado', async () => {
    await fetchStats('2026-11-06T10:00:00Z', (s) => {
      s.fixtures.played = { home: 3, away: 3, total: 6 };
    });
    const changed = await row();
    expect(changed.played).toBe(6);
    expect(changed.observedAt.toISOString()).toBe('2026-11-06T10:00:00.000Z');

    await fetchStats('2026-11-07T10:00:00Z', (s) => {
      s.fixtures.played = { home: 3, away: 3, total: 6 };
    });
    const same = await row();
    expect(same.observedAt.toISOString()).toBe('2026-11-07T10:00:00.000Z');
    expect(same.updatedAt).toEqual(changed.updatedAt);
  });

  it('resposta vazia não apaga o que já existe', async () => {
    const { afterFetch, report } = normalizeAfterFetch(db);
    await afterFetch(envelopeOf([]), request(new Date('2026-11-08T10:00:00Z')));
    expect(report()).toMatchObject({ empty: 1, normalized: 0 });
    expect((await row()).played).toBe(6);
  });
});
