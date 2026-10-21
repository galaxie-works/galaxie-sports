import { FREE_PLAN, PRO_PLAN } from '@galaxie/apisports-client';
import { describe, expect, it } from 'vitest';
import { fakeCatalog, harness } from '../testing/fake-api.js';
import {
  buildDetailRequests,
  detailsJob,
  keyOnlyFor,
  rankFixture,
  selectDetailFixtures,
} from './details-job.js';
import type { FixtureRef } from './fixtures.js';
import { planJob, runJob } from './runtime/runner.js';
import { seasonsJob } from './seasons-job.js';

const comps = new Map(fakeCatalog().map((c) => [c.leagueId, c] as const));
const derbies = new Set(['121-131', '99901-99902']);

function fx(
  id: number,
  leagueId: number,
  home: number,
  away: number,
  extra: Partial<FixtureRef> = {},
): FixtureRef {
  return {
    id,
    status: 'FT',
    date: '2024-05-01T20:00:00Z',
    leagueId,
    season: 2024,
    round: 'Regular Season - 1',
    homeId: home,
    awayId: away,
    fetchedAt: new Date(0),
    ...extra,
  };
}

describe('rankFixture / selectDetailFixtures', () => {
  it('tier 1 → clássicos de outras competições → tier 2; o resto fica de fora', () => {
    expect(rankFixture(fx(1, 71, 126, 128), comps, derbies)?.rank).toBe(0);
    expect(rankFixture(fx(2, 999, 99902, 99901), comps, derbies)).toMatchObject({ rank: 1, derby: true });
    expect(rankFixture(fx(3, 72, 7201, 7202), comps, derbies)?.rank).toBe(2);
    expect(rankFixture(fx(4, 999, 99903, 99904), comps, derbies)).toBeNull();
  });

  it('ordena por prioridade, temporada atual primeiro, depois a data mais recente; só encerradas', () => {
    const list = [
      fx(10, 72, 7201, 7202, { date: '2024-06-01' }),
      fx(11, 71, 126, 128, { date: '2024-05-01' }),
      fx(12, 71, 126, 128, { season: 2026, date: '2026-10-20' }),
      fx(13, 71, 126, 128, { date: '2024-07-01' }),
      fx(14, 71, 126, 128, { status: 'NS' }),
      fx(15, 999, 99901, 99902),
    ];
    expect(selectDetailFixtures(list, comps, derbies, { keyOnly: false }).map((f) => f.id)).toEqual([
      12, 13, 11, 15, 10,
    ]);
  });

  it('modo chave (free): só clássicos e rodadas decisivas', () => {
    const list = [
      fx(1, 71, 121, 131),
      fx(2, 71, 126, 128),
      fx(3, 13, 435, 451, { round: 'Final' }),
      fx(4, 13, 435, 1062, { round: 'Semi-finals' }),
      fx(5, 13, 451, 1062, { round: 'Group Stage - 1' }),
    ];
    expect(selectDetailFixtures(list, comps, derbies, { keyOnly: true }).map((f) => f.id)).toEqual([1, 3, 4]);
  });

  it('não pede detalhe quando o coverage da temporada não tem eventos, escalações nem estatísticas', () => {
    const noDetail = new Map(comps);
    const c = comps.get(72)!;
    noDetail.set(72, {
      ...c,
      seasons: c.seasons.map((s) => ({
        ...s,
        coverage: {
          fixtures: { events: false, lineups: false, statistics_fixtures: false, statistics_players: false },
        },
      })),
    });
    expect(rankFixture(fx(3, 72, 7201, 7202), noDetail, derbies)).toBeNull();
  });

  it('auto = só clássicos e decisivos no free; tudo nos planos pagos', () => {
    expect(keyOnlyFor('auto', FREE_PLAN)).toBe(true);
    expect(keyOnlyFor('auto', PRO_PLAN)).toBe(false);
    expect(keyOnlyFor('all', FREE_PLAN)).toBe(false);
  });
});

describe('buildDetailRequests', () => {
  const ids = Array.from({ length: 45 }, (_, i) => i + 1);

  it('pagos: lotes de 20 em fixtures?ids=, com um cursor por partida', () => {
    const r = buildDetailRequests(ids, PRO_PLAN);
    expect(r).toHaveLength(3);
    expect(r[0]!.params.ids!.split('-')).toHaveLength(20);
    expect(r[2]!.cursors.map((c) => c.key)).toEqual(['id=41', 'id=42', 'id=43', 'id=44', 'id=45']);
  });

  it('free: 1 chamada por jogo (fixtures?id=)', () => {
    const r = buildDetailRequests(ids.slice(0, 3), FREE_PLAN);
    expect(r.map((x) => x.params)).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(r[0]!.cursors).toEqual([{ sport: 'football', endpoint: '/fixtures', key: 'id=1' }]);
  });
});

describe('detailsJob', () => {
  const derbyKeys = async () => new Set(['121-131']);

  it('Pro: custo ≈ partidas ÷ 20, sem endpoints unitários, e retoma sem repetir', async () => {
    const h = harness({ plan: PRO_PLAN });
    const now = () => new Date(h.clock.t);
    await runJob(seasonsJob(h.catalog, h.raw, h.plan, now), h.deps);
    const before = h.api.calls.length;

    const job = detailsJob(h.catalog, h.raw, h.cursors, h.plan, derbyKeys);
    const plan = await planJob(job, h.deps);
    // encerradas: Série A 2021–2025 (12×5) + 6 da atual · Libertadores 2023/24 (24) + 6 · Série B 2024/25 (24) + 6
    const finished = 66 + 30 + 30;
    expect(plan.totals.network).toBe(Math.ceil(finished / 20));

    const r1 = await runJob(job, h.deps, { maxCalls: 2 });
    expect(r1).toMatchObject({ status: 'partial', callsSpent: 2 });
    const r2 = await runJob(job, h.deps);
    expect(r2.status).toBe('ok');
    expect(r2.totals.done).toBe(2);

    const calls = h.api.calls.slice(before);
    expect(calls).toHaveLength(Math.ceil(finished / 20));
    expect(calls.every((u) => u.pathname === '/fixtures' && u.searchParams.has('ids'))).toBe(true);
    const detailed = calls.flatMap((u) => u.searchParams.get('ids')!.split('-'));
    expect(new Set(detailed).size).toBe(finished);
    expect([...h.cursors.rows.keys()].filter((k) => k.startsWith('football|/fixtures|id=')).length).toBe(
      finished,
    );
  });

  it('free: só clássicos e decisivos, 1 chamada por jogo; o limite por execução vale em partidas', async () => {
    const h = harness();
    await h.dayWithoutLive();
    const now = () => new Date(h.clock.t);
    await runJob(seasonsJob(h.catalog, h.raw, h.plan, now), h.deps);
    const before = h.api.calls.length;

    const job = detailsJob(h.catalog, h.raw, h.cursors, h.plan, derbyKeys, { limit: 3 });
    const r = await runJob(job, h.deps);
    // 2022–2024: 121×131 joga 2× por temporada (6) + finais da Libertadores 2023/2024 (2) = 8 candidatos
    expect(r.callsSpent).toBe(3);
    const calls = h.api.calls.slice(before);
    expect(calls.every((u) => u.searchParams.has('id') && !u.searchParams.has('ids'))).toBe(true);

    const rest = await planJob(detailsJob(h.catalog, h.raw, h.cursors, h.plan, derbyKeys), h.deps);
    expect(rest.totals).toMatchObject({ done: 3, network: 5 });
  });
});
