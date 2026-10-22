/**
 * Simulação de dias inteiros com relógio falso, fornecedor falso e o cliente real (cota contada pelo
 * Quota Governor em memória): quarta-feira com 10 jogos, final com prorrogação e pênaltis, rajadas de 5xx.
 */
import { ApiSportsProvider } from '@galaxie/providers';
import { beforeAll, describe, expect, it } from 'vitest';
import { cupFinal, liveWorld, matchState, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { LiveRunner, type LiveRunSummary } from './runner.js';
import type { TickReport } from './poller.js';
import type { LiveDayPlan } from './types.js';

const MIN = 60_000;

interface SimResult {
  world: ReturnType<typeof liveWorld>;
  summary: LiveRunSummary;
  ticks: TickReport[];
  plans: LiveDayPlan[];
}

async function simulate(opts: {
  matches: WorldMatch[];
  plan: 'free' | 'pro';
  start: string;
  until: string;
  outages?: { from: string; to: string }[];
  dailyCallsAt?: { at: string; calls: number }[];
  runner?: ConstructorParameters<typeof LiveRunner>[0]['options'];
}): Promise<SimResult> {
  const world = liveWorld({
    matches: opts.matches,
    plan: opts.plan,
    start: new Date(opts.start),
    outages: (opts.outages ?? []).map((o) => ({ from: new Date(o.from), to: new Date(o.to) })),
  });
  const ticks: TickReport[] = [];
  const plans: LiveDayPlan[] = [];
  const dailyCalls = [...(opts.dailyCallsAt ?? [])];
  const runner = new LiveRunner({
    sport: 'football',
    // relógio simulado também no provedor: o `fetchedAt` dos erros não pode vir do relógio real
    provider: new ApiSportsProvider(world.client, { priority: 'LIVE' }, () => new Date(world.clock.now())),
    store: world.store,
    governor: world.governor,
    clock: world.clock,
    options: { idleExitMs: null, until: new Date(opts.until), ...opts.runner },
    hooks: {
      onTick: (r) => {
        ticks.push(r);
      },
      onPlan: async (p) => {
        // o "sync diário" (DAILY) gasta a parte dele no horário marcado
        while (dailyCalls.length && new Date(world.clock.now()) >= new Date(dailyCalls[0]!.at)) {
          const { calls } = dailyCalls.shift()!;
          for (let i = 0; i < calls; i++) {
            const t = await world.governor.acquire({
              api: 'football',
              priority: 'DAILY',
              endpoint: '/fixtures',
              requestHash: `daily-${world.clock.now()}-${i}`,
            });
            await world.governor.settle(t, 'ok');
          }
        }
        if (plans.at(-1)?.day !== p.day || plans.length < 2000) plans.push(p);
      },
    },
  });
  const summary = await runner.run();
  return { world, summary, ticks, plans };
}

/** Minutos de jogo em andamento (sem o intervalo) com um tick bem-sucedido da liga a no máximo `gapMs`. */
function coverage(match: WorldMatch, ticks: TickReport[], gapMs: number): number {
  const league = String(match.leagueId);
  const times = ticks
    .filter((t) => t.leagues.includes(league) && t.outcome !== 'error')
    .map((t) => t.at.getTime());
  let minutes = 0;
  let covered = 0;
  for (let t = match.kickoff.getTime(); t < match.kickoff.getTime() + 200 * MIN; t += MIN) {
    const s = matchState(match, new Date(t));
    if (!s.inPlay || s.short === 'HT') continue;
    minutes += 1;
    if (times.some((x) => Math.abs(t - x) <= gapMs)) covered += 1;
  }
  return minutes ? covered / minutes : 1;
}

function liveCallsByDay(world: SimResult['world']) {
  const out: Record<string, number> = {};
  for (const r of world.requests) {
    const day = r.at.toISOString().slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

describe('quarta-feira cheia (10 jogos, 6 ligas) no plano gratuito (100/dia)', () => {
  let sim: SimResult;
  let usage21: Awaited<ReturnType<SimResult['world']['governor']['usage']>>;
  let usage22: typeof usage21;
  beforeAll(async () => {
    sim = await simulate({
      matches: wednesdayNight(),
      plan: 'free',
      start: '2026-10-21T12:00:00Z',
      until: '2026-10-22T06:00:00Z',
      // o sync diário do dia 22 roda às 00:05 UTC e gasta 38 chamadas DAILY
      dailyCallsAt: [{ at: '2026-10-22T00:05:00Z', calls: 38 }],
    });
    usage21 = await sim.world.governor.usage('football', '2026-10-21');
    usage22 = await sim.world.governor.usage('football', '2026-10-22');
  });

  it('nunca passa do orçamento LIVE planejado nem do limite − reserva, e protege o DAILY', () => {
    for (const u of [usage21, usage22]) {
      expect(u.used.LIVE).toBeLessThanOrEqual(u.budget.LIVE);
      expect(u.totalUsed).toBeLessThanOrEqual(u.dailyLimit - u.reserve);
      expect(u.budget.DAILY).toBe(40);
    }
    // LIVE planejado = 100 − 15 (reserva) − 40 (DAILY protegido) = 45; depois do último jogo, LIVE = usado
    for (const day of ['2026-10-21', '2026-10-22']) {
      const first = sim.plans.find((p) => p.day === day && p.included.length > 0)!;
      expect(first.quotaPlan).toEqual({ LIVE: 45, DAILY: 40 });
    }
    expect(usage22.budget.LIVE).toBe(usage22.used.LIVE);
    expect(usage22.used.DAILY).toBe(38);
    const byDay = liveCallsByDay(sim.world);
    expect(byDay['2026-10-21']).toBe(usage21.used.LIVE);
    expect(byDay['2026-10-22']).toBe(usage22.used.LIVE);
  });

  it('acompanha todos os jogos relevantes até o fim, com o placar final certo', () => {
    for (const m of sim.world.matches.filter((x) => x.livePriority !== 'none')) {
      const s = sim.world.store.state(String(m.fixtureId))!;
      const truth = matchState(m, new Date('2026-10-22T06:00:00Z'));
      expect(s.status, `${m.home} x ${m.away}`).toBe('finished');
      expect(s.score?.home).toBe(truth.home);
      expect(s.score?.away).toBe(truth.away);
      expect(s.isStale).toBe(false);
    }
    // a liga sem prioridade nunca é consultada
    expect(sim.world.requests.some((r) => (r.params.live ?? '').split('-').includes('999'))).toBe(false);
    expect(sim.world.store.state('9901')!.status).toBe('scheduled');
  });

  it('confirma cada resultado com 1 chamada de detalhe e avisa o recálculo de tabela', () => {
    const details = sim.world.requests.filter((r) => r.params.id);
    expect(details.length).toBe(10);
    expect(new Set(sim.world.store.finished.map((c) => c.providerEventId)).size).toBe(10);
  });

  it('publica gols e encerramentos no change feed (sem ruído de relógio)', () => {
    const published = sim.world.store.published;
    expect(published.every((c) => c.kinds.some((k) => k !== 'clock'))).toBe(true);
    expect(published.filter((c) => c.finished)).toHaveLength(10);
    expect(published.filter((c) => c.goal).length).toBeGreaterThanOrEqual(12);
  });

  it('cada tick é uma chamada fixtures?live com as ligas da janela', () => {
    const live = sim.world.requests.filter((r) => r.params.live);
    expect(live.length).toBe(sim.summary.ticks);
    expect(live.every((r) => /^\d+(-\d+)*$/.test(r.params.live!))).toBe(true);
    // às 22:30 UTC: Brasileirão (71) e, depois das 23h, Argentina (128)
    const at2330 = live.find((r) => r.at >= new Date('2026-10-21T23:20:00Z'))!;
    expect(at2330.params.live).toBe('71-128');
  });

  it('cobre ≥ 95% dos minutos dos jogos tier 1 (tick da liga a até 2 intervalos médios)', () => {
    // métrica: um minuto em andamento está coberto se houve leitura da liga a até 2 intervalos médios dele
    const nominal = (day: string) => {
      const p = sim.plans.find((x) => x.day === day && x.included.length > 0)!;
      return p.nominalIntervalMs;
    };
    for (const m of sim.world.matches.filter((x) => x.tier === 1)) {
      const day = m.kickoff.toISOString().slice(0, 10);
      const gap = Math.max(2 * nominal(day), 5 * MIN);
      expect(coverage(m, sim.ticks, gap), `${m.home} x ${m.away}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('intervalo resultante no free: minutos (não segundos)', () => {
    const first = sim.plans.find((p) => p.day === '2026-10-21' && p.included.length > 0)!;
    expect(first.nominalIntervalMs).toBeGreaterThan(5 * MIN);
    const gaps = sim.summary.gaps.filter((g) => g < 60 * MIN);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(15_000);
  });
});

describe('mesma quarta-feira no plano Pro (7.500/dia)', () => {
  let sim: SimResult;
  let usage21: Awaited<ReturnType<SimResult['world']['governor']['usage']>>;
  beforeAll(async () => {
    sim = await simulate({
      matches: wednesdayNight(),
      plan: 'pro',
      start: '2026-10-21T12:00:00Z',
      until: '2026-10-22T06:00:00Z',
    });
    usage21 = await sim.world.governor.usage('football', '2026-10-21');
  });

  it('chega ao limite de 15 s por tick com jogo em andamento', () => {
    const gaps = sim.summary.gaps.filter((g) => g < 5 * MIN);
    const at15 = gaps.filter((g) => g === 15_000).length;
    expect(at15 / gaps.length).toBeGreaterThan(0.9);
    expect(sim.plans.find((p) => p.included.length)!.baseIntervalMs).toBe(15_000);
  });

  it('reserva só o útil para o LIVE: o resto do dia fica para o BOOTSTRAP', () => {
    expect(usage21.used.LIVE).toBeLessThanOrEqual(usage21.budget.LIVE);
    expect(usage21.budget.LIVE).toBeLessThan(7500 - 1125 - 3000);
    for (const m of sim.world.matches.filter((x) => x.livePriority !== 'none'))
      expect(sim.world.store.state(String(m.fixtureId))!.status).toBe('finished');
  });
});

describe('final com prorrogação e pênaltis', () => {
  const final = cupFinal();
  let sim: SimResult;
  beforeAll(async () => {
    sim = await simulate({
      matches: [final],
      plan: 'free',
      start: '2026-10-21T20:00:00Z',
      until: '2026-10-22T02:00:00Z',
    });
  });

  it('estende a janela e encurta o intervalo na prorrogação e nos pênaltis', () => {
    const kick = final.kickoff.getTime();
    const inEt = sim.ticks.filter(
      (t) => t.at.getTime() >= kick + 115 * MIN && t.at.getTime() < kick + 160 * MIN,
    );
    expect(inEt.length).toBeGreaterThanOrEqual(3);
    const firstHalf = sim.ticks.filter((t) => t.at.getTime() >= kick && t.at.getTime() < kick + 45 * MIN);
    const gapsEt = inEt.slice(1).map((t, i) => t.at.getTime() - inEt[i]!.at.getTime());
    const gapsFirst = firstHalf.slice(1).map((t, i) => t.at.getTime() - firstHalf[i]!.at.getTime());
    expect(Math.max(...gapsEt)).toBeLessThan(Math.min(...gapsFirst));
  });

  it('termina em PEN com placar da prorrogação e dos pênaltis', () => {
    const s = sim.world.store.state('9500')!;
    expect(s.status).toBe('finished');
    expect(s.statusDetail).toBe('PEN');
    expect(s.score).toMatchObject({ home: 2, away: 2, penalty: { home: 4, away: 3 } });
    expect(sim.world.store.finished.map((c) => c.providerEventId)).toEqual(['9500']);
  });

  it('pula o intervalo de jogo (nenhum tick nos primeiros 10 min do HT)', () => {
    const kick = final.kickoff.getTime();
    const htSeen = sim.ticks.find((t) => t.at.getTime() >= kick + 47 * MIN)!.at.getTime();
    const during = sim.ticks.filter((t) => t.at.getTime() > htSeen && t.at.getTime() < htSeen + 10 * MIN);
    expect(during).toHaveLength(0);
  });
});

describe('rajadas de 5xx do fornecedor', () => {
  const match: WorldMatch = {
    ...wednesdayNight()[3]!,
    goals: [
      { minute: 21, side: 'home' },
      { minute: 60, side: 'away' },
    ],
  };
  let sim: SimResult;
  beforeAll(async () => {
    sim = await simulate({
      matches: [match],
      plan: 'pro',
      start: '2026-10-21T21:30:00Z',
      until: '2026-10-22T01:00:00Z',
      // pane de 12 min no 2º tempo (o gol dos 60' sai durante a pane)
      outages: [{ from: '2026-10-21T23:10:00Z', to: '2026-10-21T23:22:00Z' }],
    });
  });

  it('serve o último estado válido (stale) durante a pane e se recupera depois', () => {
    const errors = sim.ticks.filter((t) => t.outcome === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.staleMarked).toBe(1);
    const staleChange = sim.world.store.published.find((c) => c.kinds.includes('stale'))!;
    expect(staleChange.score).toMatchObject({ home: 1, away: 0 }); // last-known-good, sem inventar
    const recovered = sim.world.store.published.find((c) => c.kinds.includes('recovered'))!;
    expect(recovered.score).toMatchObject({ home: 1, away: 1 });
    expect(recovered.goal).toBe(true);
    expect(sim.world.store.state(String(match.fixtureId))!).toMatchObject({
      status: 'finished',
      isStale: false,
    });
  });

  it('recua (backoff) depois de falhas seguidas, sem gastar a cota em vão', () => {
    const errorTicks = sim.ticks.filter((t) => t.outcome === 'error');
    const gaps = errorTicks.slice(1).map((t, i) => t.at.getTime() - errorTicks[i]!.at.getTime());
    expect(Math.max(...gaps)).toBeGreaterThan(15_000 * 2);
    // a pane durou 12 min: sem backoff seriam ~48 tentativas a 15 s
    expect(errorTicks.length).toBeLessThan(30);
  });
});
