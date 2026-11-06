import { FREE_PLAN, PRO_PLAN } from '@galaxie/apisports-client';
import { describe, expect, it } from 'vitest';
import { fakeCatalog, harness, NOW } from '../testing/fake-api.js';
import type { CompetitionInfo } from './catalog-source.js';
import {
  buildRotationRequests,
  buildScheduleRequests,
  buildSeasonListRequests,
  checkProviderStatus,
  reopenSeasonLists,
  seasonListPair,
  trackSeasonLists,
  dailyJob,
} from './daily-job.js';
import { InMemoryCursorStore } from './runtime/cursor-store.js';
import { planJob, plannedRequest, runJob } from './runtime/runner.js';
import { seasonsJob } from './seasons-job.js';

const DAY = 86_400_000;

describe('buildScheduleRequests', () => {
  it('fixtures?date= ontem/hoje/amanhã, injuries de hoje e /leagues — válidos uma vez por dia UTC', () => {
    const items = buildScheduleRequests(new Date(NOW));
    expect(items.map((i) => `${i.endpoint}?${new URLSearchParams(i.params)}`)).toEqual([
      '/fixtures?date=2026-10-20',
      '/fixtures?date=2026-10-21',
      '/fixtures?date=2026-10-22',
      '/injuries?date=2026-10-21',
      '/leagues?',
    ]);
    expect(items.every((i) => i.staleBefore?.toISOString() === '2026-10-21T00:00:00.000Z')).toBe(true);
  });

  it('outras 11 APIs: 3 dias cada, no endpoint de agenda de cada esporte', () => {
    const items = buildScheduleRequests(new Date(NOW), { otherSports: true, injuriesTomorrow: true });
    const others = items.filter((i) => i.step === 'outros-esportes');
    expect(others).toHaveLength(33);
    expect(others.find((i) => i.sport === 'formula-1')?.endpoint).toBe('/races');
    expect(others.find((i) => i.sport === 'mma')?.endpoint).toBe('/fights');
    expect(items.filter((i) => i.endpoint === '/injuries')).toHaveLength(2);
  });
});

describe('dailyJob', () => {
  const derbyKeys = async () => new Set(['121-131']);

  it('free: ≤ 65 chamadas, detalhe dos encerrados de ontem e reexecução segura no mesmo dia', async () => {
    const h = harness();
    const now = () => new Date(h.clock.t);
    const job = () => dailyJob(h.catalog, h.raw, h.cursors, h.plan, now, derbyKeys);

    const r1 = await runJob(job(), h.deps);
    expect(r1.status).toBe('ok');
    expect(r1.callsSpent).toBeLessThanOrEqual(65);
    // 3 agendas + injuries + leagues; detalhe: jogos de 20/10 da Série A, Libertadores (tier 1) e Série B (tier 2)
    expect(r1.phases[0]!.steps['fixtures-data']!.network).toBe(3);
    expect(r1.phases[1]!.steps.detalhe!.network).toBe(3);
    const detailIds = h.api.calls
      .filter((u) => u.searchParams.has('id'))
      .map((u) => u.searchParams.get('id'));
    // tier 1 (Libertadores e Série A, mesma data → por id) antes do tier 2 (Série B)
    expect(detailIds).toEqual(['202601305', '202607105', '202607205']);

    const r2 = await runJob(job(), h.deps);
    expect(r2.callsSpent).toBe(0);

    h.clock.t += DAY; // dia seguinte: agenda nova e os encerrados de 21/10
    const r3 = await runJob(job(), h.deps);
    expect(r3.phases[0]!.steps['fixtures-data']!.network).toBe(3);
    expect(r3.phases[1]!.steps.detalhe!.network).toBe(3);
  });

  it('limita o detalhe diário (--max-detalhes) e deixa o resto para o dia seguinte', async () => {
    const h = harness();
    const now = () => new Date(h.clock.t);
    const r = await runJob(
      dailyJob(h.catalog, h.raw, h.cursors, h.plan, now, derbyKeys, { maxDetails: 1 }),
      h.deps,
    );
    expect(r.phases[1]!.steps.detalhe!.total).toBe(1);
    h.clock.t += DAY;
    const next = await planJob(
      dailyJob(h.catalog, h.raw, h.cursors, h.plan, now, derbyKeys, { maxDetails: 10, backlogDays: 3 }),
      h.deps,
    );
    // pendentes: os 2 de 20/10 que sobraram (as agendas de 21/10 ainda não foram buscadas hoje)
    expect(next.phases[1]!.steps.detalhe!.total).toBe(2);
  });

  it('Pro: o detalhe diário sai em lotes de fixtures?ids=', async () => {
    const h = harness({ plan: PRO_PLAN });
    const now = () => new Date(h.clock.t);
    const r = await runJob(dailyJob(h.catalog, h.raw, h.cursors, h.plan, now, derbyKeys), h.deps);
    expect(r.phases[1]!.steps.detalhe!.network).toBe(1);
    expect(h.api.calls.some((u) => u.searchParams.get('ids')?.split('-').length === 3)).toBe(true);
  });

  // a lista de 21/10 foi gravada com os jogos em andamento ("1H") e não foi buscada de novo: no dia 23 ela é
  // D-2 (TTL eterno no raw) — antes, os jogos ficavam em andamento no raw e nunca recebiam detalhe
  const openDay = ['202601306', '202607106', '202607206'];

  it('Pro: anteontem gravado com jogo em andamento → rebusca a agenda (1 chamada) e detalha', async () => {
    const h = harness({ plan: PRO_PLAN });
    const now = () => new Date(h.clock.t);
    const job = () => dailyJob(h.catalog, h.raw, h.cursors, h.plan, now, derbyKeys);
    await runJob(job(), h.deps);
    h.clock.t += 2 * DAY;
    const calls = h.api.calls.length;
    const r = await runJob(job(), h.deps);
    const dates = h.api.calls.slice(calls).flatMap((u) => u.searchParams.get('date') ?? []);
    expect(dates).toContain('2026-10-21');
    expect(r.phases[0]!.steps['fixtures-data']!.network).toBe(4);
    const detailed = h.api.calls.slice(calls).flatMap((u) => u.searchParams.get('ids')?.split('-') ?? []);
    expect(detailed).toEqual(expect.arrayContaining(openDay));

    // rebuscada hoje: reexecutar não chama de novo
    expect((await planJob(job(), h.deps)).totals.network).toBe(0);
  });

  it('free (date= só em hoje ± 1): não pede a agenda de D-2, mas detalha pelo id quem já deveria ter acabado', async () => {
    const h = harness();
    const now = () => new Date(h.clock.t);
    const job = () => dailyJob(h.catalog, h.raw, h.cursors, h.plan, now, derbyKeys);
    await runJob(job(), h.deps);
    h.clock.t += 2 * DAY;
    const calls = h.api.calls.length;
    const r = await runJob(job(), h.deps);
    expect(h.api.calls.slice(calls).some((u) => u.searchParams.get('date') === '2026-10-21')).toBe(false);
    expect(r.phases[0]!.steps['fixtures-data']!.blocked ?? 0).toBe(0);
    const detailed = h.api.calls.slice(calls).flatMap((u) => u.searchParams.get('id') ?? []);
    expect(detailed).toEqual(expect.arrayContaining(openDay));
  });

  it('rodízio: elencos tier 1 com cursor vencido (7 dias) entram; recentes não', async () => {
    const h = harness();
    await h.dayWithoutLive();
    await runJob(
      seasonsJob(h.catalog, h.raw, h.plan, () => new Date(h.clock.t)),
      h.deps,
    );
    const t = h.clock.t;
    await h.cursors.complete(
      [{ sport: 'football', endpoint: '/players/squads', key: 'team=121' }],
      {},
      new Date(t - 8 * DAY),
    );
    await h.cursors.complete(
      [{ sport: 'football', endpoint: '/players/squads', key: 'team=131' }],
      {},
      new Date(t - 2 * DAY),
    );
    const candidates = [121, 131, 126].map((team) =>
      plannedRequest('squads', 'football', '/players/squads', { team }),
    );
    const picked = await buildRotationRequests(candidates, h.cursors, new Date(t), 5);
    expect(picked.map((p) => p.params.team)).toEqual(['126', '121']); // nunca buscado primeiro, depois o mais velho
    expect(picked[1]!.staleBefore?.getTime()).toBe(t - 7 * DAY);

    const job = dailyJob(h.catalog, h.raw, h.cursors, h.plan, () => new Date(h.clock.t), derbyKeys, {
      rotation: 4,
    });
    const plan = await planJob(job, h.deps);
    expect(plan.phases[2]!.steps.squads!.total).toBe(4);

    // o limite do rodízio vale por dia: reexecutar no mesmo dia não renova mais nada
    h.nextDay();
    await runJob(job, h.deps);
    const rerun = await planJob(job, h.deps);
    expect(rerun.phases[2]!.steps).toEqual({});
    expect(rerun.totals.network).toBe(0);
  });
});

describe('checkProviderStatus', () => {
  it('uma API auxiliar fora do ar não derruba o sync (nem o /status das outras)', async () => {
    const seen: string[] = [];
    const r = await checkProviderStatus(['football', 'afl', 'nba'], async (sport) => {
      seen.push(sport);
      if (sport === 'afl') throw new Error('The operation was aborted due to timeout');
      return { plan: 'Free', active: true, end: null, used: 3, limitDay: 100 };
    });
    expect(seen).toEqual(['football', 'afl', 'nba']);
    expect(r.map((x) => [x.sport, x.ok])).toEqual([
      ['football', true],
      ['afl', false],
      ['nba', true],
    ]);
  });
});

describe('buildSeasonListRequests', () => {
  const now = new Date(NOW);
  const cursor = (league: number) => ({
    sport: 'football' as const,
    endpoint: '/fixtures',
    key: `league=${league}&season=2026`,
  });
  const comp = (leagueId: number, tier: number, start: string, end: string): CompetitionInfo => ({
    ...fakeCatalog()[0]!,
    leagueId,
    slug: `liga-${leagueId}`,
    tier,
    seasons: [
      { year: 2025, current: false, startDate: '2025-01-15', endDate: '2025-12-15', coverage: null },
      { year: 2026, current: true, startDate: start, endDate: end, coverage: null },
    ],
  });

  it('temporada atual em jogo: nunca listada primeiro, depois a vencida pelo período do tier', async () => {
    const cursors = new InMemoryCursorStore();
    const comps = [
      comp(71, 1, '2026-01-15', '2026-12-15'),
      comp(72, 2, '2026-01-15', '2026-12-15'),
      comp(948, 3, '2026-09-12', '2027-05-23'), // tier 3 que só tinha o fixtures?date= do sync
      comp(500, 3, '2026-11-01', '2027-05-01'), // começa em 11 dias: o calendário já entra
      comp(501, 3, '2026-12-01', '2027-05-01'), // começa em 41 dias: ainda não
      comp(502, 3, '2026-02-01', '2026-10-01'), // acabou há 20 dias
    ];
    // tier 1 listada há 3 dias (período 2: vencida); tier 2 há 3 dias (período 7: em dia)
    await cursors.complete([cursor(71)], {}, new Date(now.getTime() - 3 * DAY));
    await cursors.complete([cursor(72)], {}, new Date(now.getTime() - 3 * DAY));
    const picked = await buildSeasonListRequests(comps, cursors, PRO_PLAN, now, 10);
    expect(picked.map((p) => p.params.league)).toEqual(['500', '948', '71']); // catálogo: tier, prioridade, slug
    expect(picked.every((p) => p.endpoint === '/fixtures' && p.params.season === '2026')).toBe(true);
    expect(picked.find((p) => p.params.league === '71')!.staleBefore?.getTime()).toBe(
      now.getTime() - 2 * DAY,
    );
    expect(picked.find((p) => p.params.league === '948')!.staleBefore?.getTime()).toBe(
      now.getTime() - 7 * DAY,
    );

    // limite do dia: só as nunca listadas cabem
    expect(
      (await buildSeasonListRequests(comps, cursors, PRO_PLAN, now, 2)).map((p) => p.params.league),
    ).toEqual(['500', '948']);
  });

  it('próxima edição com calendário antes de virar current: entra pela janela; a encerrada não', async () => {
    const virada: CompetitionInfo = {
      ...comp(103, 3, '2025-08-01', '2026-10-01'),
      seasons: [
        { year: 2025, current: true, startDate: '2025-08-01', endDate: '2026-10-01', coverage: null },
        { year: 2026, current: false, startDate: '2026-10-30', endDate: '2027-05-30', coverage: null },
        { year: 2027, current: false, startDate: null, endDate: null, coverage: null },
      ],
    };
    const picked = await buildSeasonListRequests([virada], new InMemoryCursorStore(), PRO_PLAN, now, 10);
    expect(picked.map((p) => `${p.params.league}/${p.params.season}`)).toEqual(['103/2026']);
    expect(seasonListPair(picked[0]!)).toEqual({ league: '103', year: 2026 });
    expect(
      seasonListPair(plannedRequest('squads', 'football', '/players/squads', { team: 121 })),
    ).toBeUndefined();
  });

  it('relista que não normalizou: fora do recálculo e com o cursor reaberto para a próxima execução', async () => {
    const cursors = new InMemoryCursorStore();
    const comps = [comp(71, 1, '2026-01-15', '2026-12-15'), comp(948, 3, '2026-09-12', '2027-05-23')];
    const items = await buildSeasonListRequests(comps, cursors, PRO_PLAN, now, 10);
    let errors = 0;
    const lists = trackSeasonLists({
      afterFetch: async (_env, req) => {
        if (req.params.league === '948') errors += 1;
      },
      report: () => ({ errors }),
    });
    for (const item of items) {
      await lists.afterFetch({} as never, { ...item, source: 'network', requestHash: 'h', fetchedAt: now });
      await cursors.complete(item.cursors, {}, now); // o runner conclui depois do gancho
    }
    expect(lists.normalized()).toEqual([{ league: '71', year: 2026 }]);
    expect(lists.failed()).toEqual([cursor(948)]);

    // sem normalização (--sem-normalizar): nenhuma entra no recálculo, todas voltam
    const semNormalizar = trackSeasonLists();
    for (const item of items)
      await semNormalizar.afterFetch({} as never, {
        ...item,
        source: 'network',
        requestHash: 'h',
        fetchedAt: now,
      });
    expect(semNormalizar.normalized()).toEqual([]);
    expect(semNormalizar.failed()).toEqual([cursor(71), cursor(948)]);

    await reopenSeasonLists(cursors, lists.failed());
    const next = await buildSeasonListRequests(comps, cursors, PRO_PLAN, new Date(now.getTime() + DAY), 10);
    expect(next.map((p) => p.params.league)).toEqual(['948']);
  });

  it('free: a temporada atual não é acessível por season, nada entra', async () => {
    const comps = [comp(71, 1, '2026-01-15', '2026-12-15')];
    expect(await buildSeasonListRequests(comps, new InMemoryCursorStore(), FREE_PLAN, now, 10)).toEqual([]);
  });
});

describe('dailyJob: relista da temporada atual', () => {
  const derbyKeys = async () => new Set<string>();

  it('pago: lista a temporada atual do catálogo uma vez e não repete no mesmo dia', async () => {
    const h = harness({ plan: PRO_PLAN });
    const job = () => dailyJob(h.catalog, h.raw, h.cursors, h.plan, () => new Date(h.clock.t), derbyKeys);
    const r1 = await runJob(job(), h.deps);
    expect(r1.status).toBe('ok');
    const lists = h.api.calls.filter((u) => u.pathname.endsWith('/fixtures') && u.searchParams.has('league'));
    expect(lists.map((u) => u.searchParams.get('league')).sort()).toEqual(['13', '71', '72']);
    expect(r1.phases[3]!.steps['temporada-atual']!.network).toBe(3);

    const rerun = await planJob(job(), h.deps);
    expect(rerun.phases[3]!.steps).toEqual({});
  });

  it('free: a fase não pede nada', async () => {
    const h = harness();
    const plan = await planJob(
      dailyJob(h.catalog, h.raw, h.cursors, h.plan, () => new Date(h.clock.t), derbyKeys),
      h.deps,
    );
    expect(plan.phases[3]!.steps).toEqual({});
  });
});
