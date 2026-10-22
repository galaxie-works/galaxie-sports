/**
 * Ao vivo contra o Postgres descartável: core semeado pelos normalizadores, Live Runner com o cliente real
 * (Governor e raw no Postgres) e um fornecedor falso. Verifica o core (estado, placar, incidentes, detalhe),
 * o change feed, o orçamento planejado, o cursor do detalhe e a tabela recalculada (#19).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPolicy, PgQuotaGovernor, PgRawStore } from '@galaxie/apisports-client';
import {
  apiResponse,
  changeFeed,
  competition,
  event,
  eventIncident,
  eventStateLog,
  footballFixture,
  providerMap,
  quotaBudget,
  sport,
  standing,
  syncCursor,
  type Database,
} from '@galaxie/db';
import { ApiSportsProvider, normalizeFixtures } from '@galaxie/providers';
import { PgCursorStore } from '../src/jobs/runtime/cursor-store.js';
import { LiveRunner } from '../src/live/runner.js';
import { liveStateFromPlan, saveLiveState, LIVE_STATE_ENDPOINT } from '../src/live/state.js';
import { PgLiveStore } from '../src/live/store.js';
import { normalizeAfterFetch } from '../src/normalize/after-fetch.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { recomputeStandings, seasonsWithNewResults } from '../src/standings/recompute.js';
import { apiFixture, liveWorld, wednesdayNight, type WorldMatch } from '../src/testing/live-world.js';
import { disposableDb } from './db.js';

const MIN = 60_000;
const disposable = disposableDb();
let db: Database;

// Brasileirão: 4 jogos (2 já encerrados ontem, 2 hoje à noite) + um jogo da Argentina
const bra = wednesdayNight()
  .filter((m) => m.leagueId === 71)
  .slice(0, 2);
const arg = wednesdayNight().find((m) => m.leagueId === 128)!;
const yesterday: WorldMatch[] = [
  {
    ...bra[0]!,
    fixtureId: 8801,
    home: 'Palmeiras',
    away: 'Bahia',
    kickoff: new Date('2026-10-20T22:00:00Z'),
    goals: [{ minute: 10, side: 'home' }],
  },
  {
    ...bra[0]!,
    fixtureId: 8802,
    home: 'Corinthians',
    away: 'Fortaleza',
    kickoff: new Date('2026-10-20T22:00:00Z'),
    derby: false,
    goals: [],
  },
];
const tonight = [...bra, arg];
const teamIds = new Map<string, number>();
const teamId = (name: string) => {
  if (!teamIds.has(name)) teamIds.set(name, 1000 + teamIds.size);
  return teamIds.get(name)!;
};

async function eventRow(fixtureId: number) {
  const [row] = await db
    .select({ e: event })
    .from(event)
    .innerJoin(providerMap, and(eq(providerMap.entityId, event.id), eq(providerMap.entityType, 'event')))
    .where(eq(providerMap.providerId, String(fixtureId)));
  return row!.e;
}

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  // core semeado pelos normalizadores: agenda de ontem (encerrados) e de hoje (pré-jogo), como o sync diário deixaria
  const seededAt = new Date('2026-10-21T00:10:00Z');
  await upsertBatch(
    db,
    normalizeFixtures(
      [...yesterday, ...tonight].map((m) => apiFixture(m, seededAt, teamId)),
      seededAt,
    ),
  );
  // o catálogo é dono de tier/live_priority
  await db.update(competition).set({ tier: 1, livePriority: 'high' });
});

afterAll(async () => {
  await disposable.teardown();
});

describe('ao vivo no Postgres', () => {
  it('candidatos do core: IDs do provedor, prioridade do catálogo, fase e rótulo', async () => {
    const store = new PgLiveStore(db);
    const list = await store.candidates(
      'football',
      'api-sports',
      new Date('2026-10-21T00:00:00Z'),
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(list.map((c) => c.providerEventId).sort()).toEqual(['9101', '9102', '9201']);
    expect(list.find((c) => c.providerEventId === '9101')).toMatchObject({
      providerCompetitionId: '71',
      livePriority: 'high',
      tier: 1,
      stageKind: 'regular',
      status: 'scheduled',
      label: 'Palmeiras x Corinthians',
    });
  });

  it('roda a noite: estado e placar no core, timeline, detalhe, change feed, orçamento, cursor e tabela', async () => {
    const world = liveWorld({
      matches: tonight,
      plan: 'free',
      start: new Date('2026-10-21T21:50:00Z'),
      rawStore: new PgRawStore(db),
      governor: (now) => new PgQuotaGovernor(db, () => defaultPolicy(100, 15), now),
      // pane de 8 min no 2º tempo do Brasileirão
      outages: [{ from: new Date('2026-10-21T23:20:00Z'), to: new Date('2026-10-21T23:28:00Z') }],
    });
    // mesmos IDs de time usados no seed
    for (const [name, id] of teamIds)
      if (world.teamIds(name) !== id) throw new Error('ids de time divergentes');
    const cursors = new PgCursorStore(db);
    const store = new PgLiveStore(db, {
      onFinished: async (changes) => {
        const seasonIds = [...new Set(changes.flatMap((c) => (c.seasonId ? [c.seasonId] : [])))];
        await recomputeStandings(db, { seasonIds });
      },
    });
    const runner = new LiveRunner({
      sport: 'football',
      provider: new ApiSportsProvider(world.client, { priority: 'LIVE' }, () => new Date(world.clock.now())),
      store,
      governor: world.governor,
      clock: world.clock,
      jobId: 'job-run:live-teste',
      options: { idleExitMs: 15 * MIN, failureBackoffAfter: 1 },
      hooks: {
        onPlan: (plan) => saveLiveState(db, liveStateFromPlan(plan, new Date(world.clock.now()))),
        onDetailFetched: (id, at) =>
          cursors.complete(
            [{ sport: 'football', endpoint: '/fixtures', key: `id=${id}` }],
            { source: 'live' },
            at,
          ),
      },
    });
    const summary = await runner.run();
    expect(summary.stoppedBy).toBe('idle');
    expect(summary.ticks).toBeGreaterThan(10);

    // estado final no core
    for (const m of tonight) {
      const e = await eventRow(m.fixtureId);
      expect(e).toMatchObject({ status: 'finished', statusDetail: 'FT', isStale: false });
      expect(e.score).toMatchObject({
        home: m.goals.filter((g) => g.side === 'home').length,
        away: m.goals.filter((g) => g.side === 'away').length,
      });
      const incidents = await db.select().from(eventIncident).where(eq(eventIncident.eventId, e.id));
      expect(incidents).toHaveLength(m.goals.length);
      const [ff] = await db.select().from(footballFixture).where(eq(footballFixture.eventId, e.id));
      expect(ff!.detail).toMatchObject({ lineups: [], statistics: [] });
    }
    const pal = await eventRow(9101);
    const log = await db
      .select()
      .from(eventStateLog)
      .where(eq(eventStateLog.eventId, pal.id))
      .orderBy(asc(eventStateLog.occurredAt));
    expect(log.map((l) => l.toStatus)).toEqual(expect.arrayContaining(['live', 'break', 'finished']));

    // change feed: gols, pane (stale → recuperado) e encerramentos; tabela recalculada
    const feed = await db.select().from(changeFeed).orderBy(asc(changeFeed.id));
    const live = feed.filter((f) => f.topic === 'live');
    const payloads = live.map(
      (f) => f.payload as { goal: boolean; finished: boolean; kinds: string[]; tags: string[] },
    );
    expect(payloads.filter((p) => p.finished)).toHaveLength(3);
    expect(payloads.filter((p) => p.goal).length).toBeGreaterThanOrEqual(3);
    expect(payloads.some((p) => p.kinds.includes('stale'))).toBe(true);
    expect(payloads.some((p) => p.kinds.includes('recovered'))).toBe(true);
    expect(payloads.every((p) => p.tags.includes('live'))).toBe(true);
    expect(live.every((f) => f.entityType === 'event')).toBe(true);
    expect(feed.some((f) => f.topic === 'standings')).toBe(true);

    // orçamento LIVE planejado no Governor e cota respeitada
    const budget = await db.select().from(quotaBudget).where(eq(quotaBudget.dayUtc, '2026-10-21'));
    expect(Object.fromEntries(budget.map((b) => [b.priority, b.planned]))).toMatchObject({ DAILY: 40 });
    const usage = await world.governor.usage('football', '2026-10-21');
    expect(usage.used.LIVE).toBeLessThanOrEqual(usage.budget.LIVE);

    // raw: cada tick gravou o envelope; o detalhe do encerrado marcou o cursor (o sync diário não repete)
    const [raw] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(apiResponse)
      .where(sql`${apiResponse.params} ? 'live'`);
    expect(raw!.n).toBe(world.requests.filter((r) => r.params.live).length);
    const done = await db.select().from(syncCursor).where(eq(syncCursor.endpoint, '/fixtures'));
    expect(done.map((d) => d.key).sort()).toEqual(['id=9101', 'id=9102', 'id=9201']);

    // estado do scheduler publicado para as métricas
    const [state] = await db.select().from(syncCursor).where(eq(syncCursor.endpoint, LIVE_STATE_ENDPOINT));
    expect(state!.cursor).toMatchObject({ sport: 'football' });

    // tabela da temporada atual calculada localmente (4 jogos do Brasileirão entre 4 times: 2 de ontem, 2 de hoje)
    const table = await db
      .select()
      .from(standing)
      .where(and(eq(standing.seasonId, pal.seasonId!), eq(standing.source, 'computed')))
      .orderBy(asc(standing.rank));
    expect(table).toHaveLength(4);
    expect(table.every((r) => r.played === 2)).toBe(true);
    // Palmeiras 1x0 Bahia, Corinthians 0x0 Fortaleza, Palmeiras 1x1 Corinthians, Bahia 0x1 Fortaleza
    expect(table.map((r) => r.points)).toEqual([4, 4, 2, 0]);
  });

  it('recálculo de tabelas: temporadas com resultado novo, idempotente; tabela do provedor mais nova prevalece', async () => {
    const pal = await eventRow(9101);
    const since = new Date(Date.now() - 3_600_000);
    expect(await seasonsWithNewResults(db, since)).toContain(pal.seasonId);
    const first = await recomputeStandings(db, { seasonIds: [pal.seasonId!], publish: false });
    expect(first[0]).toMatchObject({ outcome: 'written', results: 4, rows: 4 });
    const again = await recomputeStandings(db, { seasonIds: [pal.seasonId!], publish: false });
    expect(again[0]).toMatchObject({ outcome: 'written', rows: 4 });

    // tabela do provedor (ex.: bootstrap Pro) atualizada depois do último resultado: não sobrescreve
    await db
      .update(standing)
      .set({ source: 'provider', updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(standing.seasonId, pal.seasonId!));
    const kept = await recomputeStandings(db, { seasonIds: [pal.seasonId!], publish: false });
    expect(kept[0]!.outcome).toBe('provider_fresh');
  });

  it('afterFetch normaliza o detalhe buscado pelos jobs; resposta antiga do cache não regride o estado', async () => {
    const m = tonight[0]!;
    const e = await eventRow(m.fixtureId);
    const { afterFetch, report } = normalizeAfterFetch(db);
    const old = new Date('2026-10-21T22:30:00Z');
    const envelope = {
      get: 'fixtures',
      parameters: { id: String(m.fixtureId) },
      errors: [],
      results: 1,
      response: [{ ...apiFixture(m, old, teamId), lineups: [], statistics: [] }],
    };
    await afterFetch(envelope, {
      step: 'detalhe',
      sport: 'football',
      endpoint: '/fixtures',
      params: { id: String(m.fixtureId) },
      cursors: [],
      source: 'cache',
      requestHash: 'h',
      fetchedAt: old,
    });
    expect(report()).toMatchObject({ responses: 1, normalized: 1, errors: 0 });
    expect(report().stats.events.ignored).toMatchObject({ out_of_order: 1 });
    const after = await eventRow(m.fixtureId);
    expect(after.status).toBe('finished');
    expect(after.updatedAt).toEqual(e.updatedAt);

    // outro esporte ou endpoint sem core: ignorado
    await afterFetch(envelope, {
      step: 'x',
      sport: 'basketball',
      endpoint: '/games',
      params: {},
      cursors: [],
      source: 'network',
      requestHash: 'h2',
      fetchedAt: old,
    });
    expect(report().skipped).toBe(1);
  });
});
