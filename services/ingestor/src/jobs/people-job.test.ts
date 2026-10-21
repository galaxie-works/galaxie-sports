import { PRO_PLAN } from '@galaxie/apisports-client';
import { describe, expect, it } from 'vitest';
import { harness } from '../testing/fake-api.js';
import {
  buildPersonPhase,
  buildPersonRequests,
  peopleJob,
  peopleOfTeams,
  personCursor,
  teamTargets,
} from './people-job.js';
import { planJob, runJob } from './runtime/runner.js';
import { seasonsJob } from './seasons-job.js';

async function withSeasons(plan = harness()) {
  await plan.dayWithoutLive();
  await runJob(
    seasonsJob(plan.catalog, plan.raw, plan.plan, () => new Date(plan.clock.t)),
    plan.deps,
  );
  return plan;
}

describe('teamTargets / peopleOfTeams', () => {
  it('times da lista mais recente de cada competição, sem repetir, tier 1 primeiro', async () => {
    const h = await withSeasons();
    const teams = await teamTargets(h.catalog, h.raw, 2);
    expect(teams).toHaveLength(11); // 121 está na Série A e na Libertadores
    expect(teams.filter((t) => t.tier === 1)).toHaveLength(7);
    expect(teams.at(-1)).toEqual({ teamId: 7204, tier: 2 });
  });

  it('jogadores dos elencos e só o técnico atual (carreira sem fim) de cada time', async () => {
    const h = harness();
    await h.dayWithoutLive();
    for (const team of [121, 131]) {
      await h.client.get({
        sport: 'football',
        endpoint: '/players/squads',
        params: { team },
        priority: 'BOOTSTRAP',
      });
      await h.client.get({ sport: 'football', endpoint: '/coachs', params: { team }, priority: 'BOOTSTRAP' });
    }
    const people = await peopleOfTeams(h.raw, new Set([121]));
    expect(people.players).toHaveLength(25);
    expect(people.coaches).toEqual([1210]); // 1211 já saiu do clube
  });
});

describe('buildPersonRequests / buildPersonPhase', () => {
  it('lotes de 20 pessoas por chamada, um cursor por pessoa', () => {
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    const r = buildPersonRequests('trophies-jogadores', '/trophies', 'player', ids);
    expect(r).toHaveLength(3);
    expect(r[0]!.params.players!.split('-')).toHaveLength(20);
    expect(r[2]!.cursors[0]).toEqual({ sport: 'football', endpoint: '/trophies', key: 'player=41' });
    expect(buildPersonRequests('t', '/sidelined', 'coach', [7])[0]!.params).toEqual({ coachs: '7' });
  });

  it('pessoas já concluídas não entram nos lotes pendentes', async () => {
    const h = harness();
    await h.cursors.complete([personCursor('/trophies', 'player', 2)], {}, new Date(h.clock.t));
    const items = await buildPersonPhase({ players: [1, 2, 3], coaches: [] }, h.cursors);
    const trophies = items.filter((i) => i.endpoint === '/trophies');
    expect(trophies.map((i) => i.params.players)).toEqual(['2', '1-3']);
  });
});

describe('peopleJob', () => {
  it('times → pessoas → h2h dos clássicos; a segunda execução não gasta nada', async () => {
    const h = await withSeasons();
    const before = h.api.calls.length;
    const job = peopleJob(
      h.catalog,
      h.raw,
      h.cursors,
      h.plan,
      () => new Date(h.clock.t),
      async () => ['121-131'],
    );
    h.nextDay(); // o bootstrap das temporadas gastou 62 da cota de ontem
    await h.dayWithoutLive();
    const r = await runJob(job, h.deps);
    expect(r.status).toBe('ok');
    const steps = Object.assign({}, ...r.phases.map((p) => p.steps));
    expect(steps.squads.network).toBe(11);
    expect(steps.coachs.network).toBe(11);
    expect(steps.transfers.network).toBe(11);
    // 7 elencos tier 1 × 25 = 175 jogadores → 9 lotes; 7 técnicos atuais → 1 lote
    expect(steps['trophies-jogadores'].network).toBe(9);
    expect(steps['sidelined-jogadores'].network).toBe(9);
    expect(steps['trophies-tecnicos'].network).toBe(1);
    expect(steps['h2h-classicos'].network).toBe(1);
    expect(h.api.calls.length - before).toBe(33 + 20 + 1);

    const again = await planJob(job, h.deps);
    expect(again.totals.network).toBe(0);
  });

  it('estatísticas de jogadores: página 1 por temporada tier 1, depois as demais pelo paging', async () => {
    const h = await withSeasons(harness({ plan: PRO_PLAN }));
    const job = peopleJob(
      h.catalog,
      h.raw,
      h.cursors,
      h.plan,
      () => new Date(h.clock.t),
      async () => [],
      {
        derbies: false,
        playerStats: true,
      },
    );
    const r = await runJob(job, h.deps);
    // Pro: Série A 2021–2026 (6) + Libertadores 2023, 2024, 2026 (3) = 9 temporadas × 3 páginas
    expect(r.phases[2]!.steps.players!.network).toBe(9);
    expect(r.phases[3]!.steps.players!.network).toBe(18);
  });
});
