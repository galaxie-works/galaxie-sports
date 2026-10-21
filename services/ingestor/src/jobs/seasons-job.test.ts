import { FREE_PLAN, PRO_PLAN } from '@galaxie/apisports-client';
import { describe, expect, it } from 'vitest';
import { fakeCatalog, harness, NOW } from '../testing/fake-api.js';
import { reconstructSeasonFromH2h } from './fixtures.js';
import { planJob, runJob } from './runtime/runner.js';
import { buildSeasonRequests, seasonsJob, selectSeasons } from './seasons-job.js';

const now = new Date(NOW);
const [serieA, , serieB] = fakeCatalog();

describe('selectSeasons', () => {
  it('free: só 2022–2024, da mais recente para a mais antiga', () => {
    expect(selectSeasons(serieA!, FREE_PLAN, now).map((s) => s.year)).toEqual([2024, 2023, 2022]);
  });

  it('Pro: tier 1 todas as temporadas iniciadas; tier 2 só as 3 mais recentes', () => {
    expect(selectSeasons(serieA!, PRO_PLAN, now).map((s) => s.year)).toEqual([
      2026, 2025, 2024, 2023, 2022, 2021,
    ]);
    expect(selectSeasons(serieB!, PRO_PLAN, now).map((s) => s.year)).toEqual([2026, 2025, 2024]);
    expect(selectSeasons(serieA!, PRO_PLAN, now, { tier1Seasons: 2 }).map((s) => s.year)).toEqual([
      2026, 2025,
    ]);
  });

  it('não inclui temporada que ainda não começou', () => {
    const future = { ...serieA!, seasons: [{ ...serieA!.seasons[0]!, year: 2027, startDate: '2027-01-20' }] };
    expect(selectSeasons(future, PRO_PLAN, now)).toEqual([]);
  });
});

describe('buildSeasonRequests', () => {
  it('9 chamadas por temporada, pulando o que o coverage nega, + venues por país', () => {
    const items = buildSeasonRequests(fakeCatalog(), FREE_PLAN, now);
    const by = (step: string) => items.filter((i) => i.step === step);
    // Série A 3 + Libertadores 2 (2023, 2024) + Série B 3 = 8 temporadas
    expect(by('fixtures')).toHaveLength(8);
    expect(by('injuries').filter((i) => i.skip)).toHaveLength(2); // Libertadores: injuries=false
    expect(by('standings').filter((i) => i.skip)).toHaveLength(3); // Série B: standings=false
    expect(by('topredcards').filter((i) => i.skip)).toHaveLength(3);
    expect(by('rounds')[0]!.params).toEqual({ dates: 'true', league: '13', season: '2024' });
    expect(by('venues').map((i) => i.params)).toEqual([{ country: 'Brazil' }]);
    expect(items[0]!.cursors).toEqual([
      { sport: 'football', endpoint: '/teams', key: 'league=13&season=2024' },
    ]);
  });

  it('ordena por tier e recência: a temporada mais recente de cada liga tier 1 vem antes das antigas', () => {
    const order = buildSeasonRequests(fakeCatalog(), FREE_PLAN, now)
      .filter((i) => i.step === 'fixtures')
      .map((i) => `${i.params.league}/${i.params.season}`);
    expect(order).toEqual([
      '13/2024',
      '71/2024',
      '13/2023',
      '71/2023',
      '71/2022',
      '72/2024',
      '72/2023',
      '72/2022',
    ]);
  });
});

describe('seasonsJob', () => {
  it('free: executa as listas e reconstrói a temporada atual da liga tier 1 via h2h', async () => {
    const h = harness();
    await h.dayWithoutLive();
    const job = seasonsJob(h.catalog, h.raw, h.plan, () => new Date(h.clock.t), { h2hCurrentSeason: true });

    const before = await planJob(job, h.deps);
    expect(before.phases[1]!.partial).toBe(true);
    expect(before.phases[1]!.steps).toEqual({}); // os times de 2024 ainda não estão no raw

    const report = await runJob(job, h.deps);
    expect(report.status).toBe('ok');
    // 8 temporadas × 9 = 72 − 11 sem cobertura (injuries 2, standings 3, cartões 6) + 1 venue = 62
    expect(report.phases[0]!.steps.fixtures!.network).toBe(8);
    expect(report.totals.noCoverage).toBe(11);
    expect(report.phases[0]!.steps.venues!.network).toBe(1);
    // 4 times da Série A 2024 → 6 pares de h2h
    expect(report.phases[1]!.steps['h2h-temporada-atual']!.network).toBe(6);
    expect(h.api.calls.every((u) => u.searchParams.get('season') !== '2026')).toBe(true);

    const current = await reconstructSeasonFromH2h(h.raw, 71, 2026);
    expect(current).toHaveLength(12); // turno e returno, sem duplicatas entre os pares
    expect(new Set(current.map((f) => f.fixture.id)).size).toBe(12);

    const again = await planJob(job, h.deps);
    expect(again.totals.network).toBe(0);
  });

  it('Pro: inclui a temporada atual por season e não precisa do h2h', async () => {
    const h = harness({ plan: PRO_PLAN });
    const job = seasonsJob(h.catalog, h.raw, h.plan, () => new Date(h.clock.t), {
      leagues: [71],
      h2hCurrentSeason: true,
    });
    const plan = await planJob(job, h.deps);
    expect(plan.phases[0]!.steps.fixtures!.total).toBe(6);
    expect(plan.phases[1]!.steps).toEqual({});
  });

  it('para quando a cota acaba e a próxima execução continua de onde parou', async () => {
    const h = harness({ dailyLimit: 30 }); // 30 − 5 de reserva = 25 por dia sem ao vivo
    const job = () => seasonsJob(h.catalog, h.raw, h.plan, () => new Date(h.clock.t));
    const spent: number[] = [];
    for (let day = 0; day < 5; day++) {
      await h.dayWithoutLive();
      const r = await runJob(job(), h.deps);
      spent.push(r.callsSpent);
      if (r.status === 'ok') break;
      expect(r.stoppedBy).toBe('quota');
      h.nextDay();
    }
    expect(spent).toEqual([25, 25, 12]); // 62 chamadas em 3 dias
    expect(new Set(h.api.calls.map((u) => u.pathname + u.search)).size).toBe(62);
  });
});
