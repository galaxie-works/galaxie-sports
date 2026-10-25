import { describe, expect, it } from 'vitest';
import {
  availableForLive,
  decideTick,
  isRelevant,
  matchWindow,
  mergeWindows,
  planLiveDay,
  rankCandidates,
  runtimeWeight,
  windowEnd,
  type UsageLike,
} from './schedule.js';
import type { LiveCandidate } from './types.js';

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

function cand(id: string, kickoff: string, extra: Partial<LiveCandidate> = {}): LiveCandidate {
  return {
    eventId: id,
    providerEventId: id.replace(/\D/g, '') || '1',
    sport: 'football',
    competitionId: 'c71',
    providerCompetitionId: '71',
    seasonId: 's71',
    startsAt: at(kickoff),
    status: 'scheduled',
    statusDetail: 'NS',
    clock: null,
    score: null,
    lastValidAt: null,
    tier: 1,
    livePriority: 'high',
    stageKind: 'regular',
    derby: false,
    importance: 0,
    label: id,
    ...extra,
  };
}

function usage(
  limit: number,
  used: Partial<UsageLike['used']> = {},
  extra: Partial<UsageLike> = {},
): UsageLike {
  const u = { BOOTSTRAP: 0, DAILY: 0, LIVE: 0, ADHOC: 0, ...used };
  return {
    dailyLimit: limit,
    reserve: Math.ceil(limit * 0.15),
    used: u,
    budget: {
      BOOTSTRAP: 0,
      DAILY: Math.floor(limit * 0.4),
      LIVE: Math.floor(limit * 0.4),
      ADHOC: Math.floor(limit * 0.05),
    },
    totalUsed: Object.values(u).reduce((a, b) => a + b, 0),
    ...extra,
  };
}

const FREE = usage(100);
const PRO = usage(7500);

describe('janelas', () => {
  it('futebol: apito − 5 → + 130 min, intervalo de jogo com peso 0 e reta final com peso 2', () => {
    const w = matchWindow(cand('e1', '2026-10-21T22:00:00Z'), at('2026-10-21T12:00:00Z'));
    expect(w.start).toEqual(at('2026-10-21T21:55:00Z'));
    expect(w.end).toEqual(at('2026-10-22T00:10:00Z'));
    expect(w.contingentEnd).toBeNull();
    expect(w.phases.map((p) => [p.start.toISOString().slice(11, 16), p.weight])).toEqual([
      ['21:55', 1],
      ['22:47', 0],
      ['23:02', 1],
      ['23:32', 2],
    ]);
  });

  it('mata-mata: extensão contingente de 45 min; prorrogação confirmada vira janela firme', () => {
    const final = cand('e2', '2026-10-21T22:00:00Z', { stageKind: 'final' });
    const w = matchWindow(final, at('2026-10-21T12:00:00Z'));
    expect(w.end).toEqual(at('2026-10-22T00:10:00Z'));
    expect(w.contingentEnd).toEqual(at('2026-10-22T00:55:00Z'));
    expect(windowEnd(w)).toEqual(at('2026-10-22T00:55:00Z'));

    const inEt = matchWindow(
      {
        ...final,
        status: 'live',
        statusDetail: 'ET',
        clock: { minute: 98, extra: null, period: 'ET' },
        lastValidAt: at('2026-10-22T00:03:00Z'),
      },
      at('2026-10-22T00:03:00Z'),
    );
    expect(inEt.contingentEnd).toBeNull();
    expect(inEt.end.getTime()).toBeGreaterThanOrEqual(at('2026-10-22T00:50:00Z').getTime());
    expect(inEt.phases.at(-1)!.weight).toBe(2);
  });

  it('alinha a janela pelo relógio de jogo quando o apito atrasa', () => {
    // 1º tempo aos 10' às 22:20 → apito real às 22:10 (10 min de atraso)
    const late = cand('e3', '2026-10-21T22:00:00Z', {
      status: 'live',
      statusDetail: '1H',
      clock: { minute: 10, extra: null, period: '1H' },
      lastValidAt: at('2026-10-21T22:20:00Z'),
    });
    const w = matchWindow(late, at('2026-10-21T22:20:00Z'));
    expect(w.start).toEqual(at('2026-10-21T22:05:00Z'));
    expect(w.end).toEqual(at('2026-10-22T00:20:00Z'));
  });

  it('jogo ainda em andamento no core mantém a janela aberta (com teto)', () => {
    const stuck = cand('e4', '2026-10-21T22:00:00Z', {
      status: 'live',
      statusDetail: '2H',
      clock: { minute: 90, extra: 9, period: '2H' },
      lastValidAt: at('2026-10-22T00:09:00Z'),
    });
    const now = at('2026-10-22T00:30:00Z');
    expect(matchWindow(stuck, now).end).toEqual(at('2026-10-22T00:40:00Z'));
    expect(matchWindow(stuck, at('2026-10-22T05:00:00Z')).end).toEqual(at('2026-10-22T02:00:00Z'));
  });

  it('une janelas sobrepostas e lista as ligas em ordem numérica', () => {
    const a = cand('a', '2026-10-21T22:00:00Z', { providerCompetitionId: '128' });
    const b = cand('b', '2026-10-21T23:00:00Z', { providerCompetitionId: '71' });
    const c = cand('c', '2026-10-22T02:00:00Z', { providerCompetitionId: '262' });
    const now = at('2026-10-21T12:00:00Z');
    const segs = mergeWindows(
      [a, b, c].map((x) => ({ candidate: x, window: matchWindow(x, now) })),
      at('2026-10-21T00:00:00Z'),
      at('2026-10-23T00:00:00Z'),
    );
    expect(
      segs.map((s) => [s.start.toISOString().slice(11, 16), s.end.toISOString().slice(11, 16), s.leagues]),
    ).toEqual([
      ['21:55', '01:10', ['71', '128']],
      ['01:55', '04:10', ['262']],
    ]);
  });
});

describe('orçamento', () => {
  it('free: 100 − 15 de reserva − 40 protegidos para o DAILY = 45 para o ao vivo', () => {
    expect(availableForLive(FREE)).toEqual({ available: 45, protectedDaily: 40 });
  });

  it('desconta o já usado e protege só o saldo do DAILY; o contador do fornecedor é piso', () => {
    expect(availableForLive(usage(100, { DAILY: 30, BOOTSTRAP: 10, LIVE: 5 }))).toEqual({
      available: 85 - 45 - 10,
      protectedDaily: 40,
    });
    expect(availableForLive(usage(100, { DAILY: 55 }))).toEqual({ available: 30, protectedDaily: 55 });
    expect(availableForLive(usage(100, {}, { providerUsed: 20 })).available).toBe(25);
    expect(availableForLive(FREE, 20)).toEqual({ available: 65, protectedDaily: 20 });
  });
});

describe('plano do dia', () => {
  it('dia sem jogo relevante: LIVE = 0 (libera a folga para o BOOTSTRAP)', () => {
    const plan = planLiveDay({
      sport: 'football',
      now: at('2026-10-21T00:00:00Z'),
      candidates: [cand('x', '2026-10-21T20:00:00Z', { livePriority: 'none', tier: 3 })],
      usage: FREE,
    });
    expect(plan.included).toHaveLength(0);
    expect(plan.excluded).toEqual([{ eventId: 'x', label: 'x', reason: 'not_relevant' }]);
    expect(plan.quotaPlan).toEqual({ LIVE: 0, DAILY: 40 });
    expect(decideTick(plan, at('2026-10-21T20:00:00Z'), null)).toEqual({
      kind: 'done',
      reason: 'no_windows',
    });
  });

  it('um jogo prioritário no free: ~3 min de intervalo médio (135 min ÷ 44 ticks)', () => {
    const plan = planLiveDay({
      sport: 'football',
      now: at('2026-10-21T00:00:00Z'),
      candidates: [cand('e1', '2026-10-21T20:00:00Z')],
      usage: FREE,
    });
    expect(plan.windowMinutes).toBe(135);
    expect(plan.budget).toMatchObject({ liveTotal: 45, finalizeReserve: 1, ticksLeft: 44, tickCost: 1 });
    expect(plan.nominalIntervalMs / MIN).toBeCloseTo(135 / 44, 2);
    // minuto normal × reta final (peso 2) × intervalo de jogo (peso 0)
    expect(plan.weightedMinutes).toBe(52 + 30 + 2 * 38);
    expect(plan.featured).toBe(false);
  });

  it('pro: satura em 15 s e reserva só o útil (o resto vai para o BOOTSTRAP)', () => {
    const plan = planLiveDay({
      sport: 'football',
      now: at('2026-10-21T00:00:00Z'),
      candidates: [cand('e1', '2026-10-21T20:00:00Z')],
      usage: PRO,
      options: { featured: 'auto' },
    });
    expect(plan.baseIntervalMs).toBe(15_000);
    expect(plan.featured).toBe(true);
    // 120 minutos ativos × 4 ticks × 2 chamadas (live + detalhe) + 1 confirmação
    expect(plan.budget.liveTotal).toBe(120 * 4 * 2 + 1);
    expect(plan.budget.liveTotal).toBeLessThan(availableForLive(PRO).available);
  });

  it('sábado de 10 h no free: os jogos menos prioritários saem para manter o intervalo ≤ 15 min', () => {
    const kickoffs = ['15:00', '16:30', '18:00', '19:30', '21:00', '22:30', '23:30'];
    const top = kickoffs.map((k, i) =>
      cand(`top${i}`, `2026-10-24T${k}:00Z`, { providerCompetitionId: String(100 + i), importance: 10 }),
    );
    const extra = [
      cand('derby-low', '2026-10-24T12:00:00Z', {
        livePriority: 'low',
        tier: 2,
        derby: true,
        providerCompetitionId: '300',
      }),
      cand('medium', '2026-10-24T13:00:00Z', {
        livePriority: 'medium',
        tier: 2,
        providerCompetitionId: '301',
      }),
    ];
    const plan = planLiveDay({
      sport: 'football',
      now: at('2026-10-24T00:00:00Z'),
      candidates: [...top, ...extra],
      usage: FREE,
    });
    expect(plan.included.map((i) => i.candidate.eventId).sort()).toEqual(top.map((t) => t.eventId).sort());
    expect(
      plan.excluded
        .filter((e) => e.reason === 'budget')
        .map((e) => e.eventId)
        .sort(),
    ).toEqual(['derby-low', 'medium']);
    expect(plan.nominalIntervalMs).toBeLessThanOrEqual(15 * MIN);

    // a ordem sugerida pelo priorizador troca quem entra
    const reordered = planLiveDay({
      sport: 'football',
      now: at('2026-10-24T00:00:00Z'),
      candidates: [...top, ...extra],
      usage: FREE,
      order: ['derby-low', 'medium'],
    });
    expect(reordered.included.slice(0, 2).map((i) => i.candidate.eventId)).toEqual(['derby-low', 'medium']);
  });

  it('exclui encerrados, sem vínculo com o provedor e fora do dia; determinístico', () => {
    const input = {
      sport: 'football',
      now: at('2026-10-21T21:00:00Z'),
      candidates: [
        cand('done', '2026-10-21T19:00:00Z', { status: 'finished', statusDetail: 'FT' }),
        cand('noid', '2026-10-21T22:00:00Z', { providerCompetitionId: null }),
        cand('past', '2026-10-21T12:00:00Z'),
        cand('tomorrow', '2026-10-22T20:00:00Z'),
        cand('ok', '2026-10-21T22:00:00Z'),
      ],
      usage: FREE,
    };
    const plan = planLiveDay(input);
    expect(plan.included.map((i) => i.candidate.eventId)).toEqual(['ok']);
    expect(Object.fromEntries(plan.excluded.map((e) => [e.eventId, e.reason]))).toEqual({
      done: 'terminal',
      noid: 'no_provider_ids',
      past: 'outside_day',
      tomorrow: 'outside_day',
    });
    expect(JSON.stringify(planLiveDay(input))).toBe(JSON.stringify(plan));
  });

  it('jogos em andamento vêm antes na ordem e nunca perdem a vaga', () => {
    const live = cand('live', '2026-10-21T22:00:00Z', {
      livePriority: 'medium',
      status: 'live',
      statusDetail: '1H',
    });
    const big = cand('big', '2026-10-21T23:00:00Z', { derby: true, importance: 90 });
    expect(rankCandidates([big, live]).map((c) => c.eventId)).toEqual(['live', 'big']);
    expect(rankCandidates([big, live], ['big']).map((c) => c.eventId)).toEqual(['live', 'big']);
  });
});

describe('decisão do tick', () => {
  const plan = planLiveDay({
    sport: 'football',
    now: at('2026-10-21T00:00:00Z'),
    candidates: [cand('e1', '2026-10-21T20:00:00Z')],
    usage: FREE,
  });

  it('espera a janela, chama no início e respeita o intervalo', () => {
    expect(decideTick(plan, at('2026-10-21T18:00:00Z'), null)).toEqual({
      kind: 'wait',
      until: at('2026-10-21T19:55:00Z'),
      reason: 'gap',
      active: false,
    });
    const first = decideTick(plan, at('2026-10-21T19:55:00Z'), null);
    expect(first).toMatchObject({ kind: 'tick', leagues: ['71'], eventIds: ['e1'], weight: 1 });
    const next = decideTick(plan, at('2026-10-21T19:56:00Z'), at('2026-10-21T19:55:00Z'));
    expect(next).toMatchObject({ kind: 'wait', reason: 'interval', active: true });
    expect(decideTick(plan, at('2026-10-21T23:00:00Z'), null)).toEqual({
      kind: 'done',
      reason: 'no_windows',
    });
  });

  it('pula o intervalo de jogo e encurta na reta final', () => {
    const ht = {
      ...plan.included[0]!.candidate,
      status: 'break' as const,
      statusDetail: 'HT',
      lastValidAt: at('2026-10-21T20:48:00Z'),
    };
    const htPlan = { ...plan, included: [{ ...plan.included[0]!, candidate: ht }] };
    const d = decideTick(htPlan, at('2026-10-21T20:50:00Z'), at('2026-10-21T20:48:00Z'));
    expect(d).toMatchObject({ kind: 'wait', reason: 'halftime', until: at('2026-10-21T20:58:00Z') });

    const late = {
      ...ht,
      status: 'live' as const,
      statusDetail: '2H',
      clock: { minute: 80, extra: null, period: '2H' },
    };
    expect(runtimeWeight(late, at('2026-10-21T21:40:00Z'))).toBe(2);
    const latePlan = { ...plan, included: [{ ...plan.included[0]!, candidate: late }] };
    const tick = decideTick(latePlan, at('2026-10-21T21:40:00Z'), null);
    expect(tick).toMatchObject({ kind: 'tick', weight: 2 });
    expect(tick.kind === 'tick' && tick.intervalMs).toBeCloseTo(plan.baseIntervalMs / 2, 3);
  });

  it('perto do fim da cota a reserva de confirmação dos jogos em andamento não encolhe a zero', () => {
    // 100 − 15 − 40 (DAILY) = 45 para o LIVE; 42 já gastos → sobram 3 (1/4 disso arredonda para 0)
    const live = (id: string) =>
      cand(id, '2026-10-21T20:00:00Z', {
        status: 'live',
        statusDetail: '2H',
        clock: { minute: 70, extra: null, period: '2H' },
        lastValidAt: at('2026-10-21T21:20:00Z'),
      });
    const plan = planLiveDay({
      sport: 'football',
      now: at('2026-10-21T21:20:00Z'),
      candidates: [live('e1'), live('e2'), cand('e3', '2026-10-21T22:00:00Z')],
      usage: usage(100, { LIVE: 42, DAILY: 40 }),
    });
    // os em andamento ficam sempre; o que ainda vai começar não cabe no saldo
    expect(plan.included.map((i) => i.candidate.eventId)).toEqual(['e1', 'e2']);
    // um por jogo em andamento (o teto de 1/4 daria 0) e o resto em ticks
    expect(plan.budget).toMatchObject({ finalizeReserve: 2, ticksLeft: 1 });

    // com saldo folgado, nada muda: 1 por jogo, todos dentro do teto
    const roomy = planLiveDay({
      sport: 'football',
      now: at('2026-10-21T21:20:00Z'),
      candidates: [live('e1'), live('e2'), cand('e3', '2026-10-21T22:00:00Z')],
      usage: usage(100, { DAILY: 40 }),
    });
    expect(roomy.budget.finalizeReserve).toBe(3);
  });

  it('orçamento esgotado: espera o próximo dia de cota', () => {
    const empty = planLiveDay({
      sport: 'football',
      now: at('2026-10-21T19:00:00Z'),
      candidates: [cand('e1', '2026-10-21T20:00:00Z')],
      usage: usage(100, { LIVE: 45, DAILY: 40 }),
    });
    expect(empty.budget.ticksLeft).toBe(0);
    expect(decideTick(empty, at('2026-10-21T20:10:00Z'), null)).toEqual({
      kind: 'wait',
      until: at('2026-10-22T00:00:00Z'),
      reason: 'budget',
      active: true,
    });
  });
});

describe('isRelevant', () => {
  const c = (livePriority: LiveCandidate['livePriority'], derby = false) =>
    ({ livePriority, derby }) as LiveCandidate;

  it('padrão: alta e média, ou clássico em qualquer competição', () => {
    expect([c('high'), c('medium'), c('low'), c('none'), c('none', true)].map((x) => isRelevant(x))).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('LIVE_MIN_PRIORITY=low põe as ligas menores no ao vivo (nunca as sem prioridade)', () => {
    expect([c('low'), c('none')].map((x) => isRelevant(x, 'low'))).toEqual([true, false]);
    expect(isRelevant(c('medium'), 'high')).toBe(false);
  });
});
