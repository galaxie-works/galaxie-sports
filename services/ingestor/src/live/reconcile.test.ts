import { FakeProvider, normalizeFixtures, type NormalizedBatch } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { apiFixture, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { InMemoryLiveStore } from './memory-store.js';
import { reconcileLive, reconcileReason, reconcileTargets } from './reconcile.js';
import type { LiveCandidate } from './types.js';

const MIN = 60_000;
const ids = new Map<string, number>();
const teamId = (name: string) => {
  if (!ids.has(name)) ids.set(name, 7000 + ids.size);
  return ids.get(name)!;
};

const batchAt = (matches: WorldMatch[], at: Date, detail = false): NormalizedBatch =>
  normalizeFixtures(
    matches.map((m) => ({
      ...apiFixture(m, at, teamId),
      ...(detail ? { lineups: [], statistics: [] } : {}),
    })),
    at,
  );

function setup(matches: WorldMatch[]) {
  const store = new InMemoryLiveStore().seed(
    matches.map((m) => ({
      eventId: `ev-${m.fixtureId}`,
      providerEventId: String(m.fixtureId),
      sport: 'football',
      competitionId: `comp-${m.leagueId}`,
      providerCompetitionId: String(m.leagueId),
      seasonId: `season-${m.leagueId}`,
      startsAt: m.kickoff,
      tier: m.tier,
      livePriority: m.livePriority,
      stageKind: m.stageKind,
      derby: m.derby ?? false,
      importance: 0,
      label: `${m.home} x ${m.away}`,
    })),
  );
  return { store, provider: new FakeProvider('api-sports') };
}

describe('reconcileLive', () => {
  const [match, other] = [wednesdayNight()[3]!, wednesdayNight()[4]!];
  const kick = match.kickoff.getTime();

  it('confirma pelo detalhe quem o core ainda dá como em andamento e encerra o que acabou', async () => {
    const { store, provider } = setup([match, other]);
    // o ao vivo viu os dois em andamento e depois parou de acompanhar (processo caiu, desistiu, etc.)
    await store.applyBatch(batchAt([match, other], new Date(kick + 100 * MIN)));
    expect(store.state('9101')!.status).toBe('live');

    const now = new Date(kick + 130 * MIN);
    provider
      .willReturn('getEventDetail', batchAt([match], now, true))
      .willReturn('getEventDetail', batchAt([other], now, true));
    const fetched: string[] = [];
    const r = await reconcileLive(provider, store, {
      sport: 'football',
      now,
      jobId: 'job-run:teste',
      onDetailFetched: (id) => {
        fetched.push(id);
      },
    });

    expect(r.checked).toEqual(['9101', '9102']);
    expect(r.calls).toBe(2);
    expect(provider.calls[0]).toEqual({
      method: 'getEventDetail',
      args: ['football', '9101', { priority: 'LIVE', jobId: 'job-run:teste' }],
    });
    expect(store.state('9101')).toMatchObject({ status: 'finished', statusDetail: 'FT' });
    expect(r.finished).toEqual(['9101', '9102']);
    expect(fetched).toEqual(['9101', '9102']);
    expect(store.finished.map((c) => c.providerEventId)).toEqual(['9101', '9102']);
    expect(r.published).toBeGreaterThan(0);
  });

  it('respeita o máximo de chamadas, começando pelos jogos mais antigos', async () => {
    const { store, provider } = setup([match, other]);
    await store.applyBatch(batchAt([match, other], new Date(kick + 60 * MIN)));
    const now = new Date(kick + 70 * MIN);
    provider.willReturn('getEventDetail', batchAt([match], now, true));
    const r = await reconcileLive(provider, store, { sport: 'football', now, max: 1, force: true });
    expect(r).toMatchObject({ inPlay: 2, pending: 2, checked: ['9101'], calls: 1 });
  });

  it('ignora jogos encerrados, futuros ou antigos demais', () => {
    const now = new Date(kick + 60 * MIN);
    const base = { providerEventId: '1', livePriority: 'low' as const } as never;
    const c = (status: string, startsAt: Date) => ({ ...(base as object), status, startsAt }) as never;
    const targets = reconcileTargets(
      [
        c('live', new Date(kick)),
        c('starting', new Date(kick + 59 * MIN)),
        c('finished', new Date(kick)),
        c('scheduled', new Date(kick + 90 * MIN)),
        c('live', new Date(kick - 7 * 60 * MIN)),
      ],
      now,
      { force: true },
    );
    expect(targets.map((t: { status: string }) => t.status)).toEqual(['live', 'starting']);
  });

  it('agendada: não gasta cota com o que o ao vivo está atualizando; confere só os parados', async () => {
    const low = { ...other, livePriority: 'low' as const, derby: false };
    const { store, provider } = setup([match, low]);
    // o poller atualizou o jogo principal há 5 min; o de prioridade baixa (fora do ao vivo) nunca foi visto
    await store.applyBatch(batchAt([match], new Date(kick + 55 * MIN)));
    const now = new Date(kick + 60 * MIN);
    const r = await reconcileLive(provider, store, { sport: 'football', now });
    expect(r).toMatchObject({ inPlay: 1, pending: 0, checked: [], calls: 0 });
    expect(provider.calls).toHaveLength(0);

    // o ao vivo parou (processo caiu): 30 min sem observação válida → suspeito, confere
    const later = new Date(kick + 85 * MIN);
    provider.willReturn('getEventDetail', batchAt([match], later, true));
    const r2 = await reconcileLive(provider, store, { sport: 'football', now: later });
    expect(r2).toMatchObject({ pending: 1, checked: ['9101'], calls: 1 });
  });

  it('com o relógio dos eventos: jogo fora do ao vivo nunca observado é conferido uma vez, ao ser encerrado pelo horário', async () => {
    const low = { ...other, livePriority: 'low' as const, derby: false };
    const { store, provider } = setup([low]);
    const okick = low.kickoff.getTime();
    // o relógio marca "ao vivo" no apito (sem dado da fonte): no meio do jogo não vale a chamada
    store.advanceClock(new Date(okick + 60 * MIN));
    expect(store.state('9102')).toMatchObject({ status: 'live', statusSource: 'temporal' });
    const mid = await reconcileLive(provider, store, { sport: 'football', now: new Date(okick + 60 * MIN) });
    expect(mid).toMatchObject({ inPlay: 1, pending: 0, calls: 0 });

    // em ends_at_expected o relógio encerra sem placar: a reconciliação confirma na fonte
    const now = new Date(okick + 130 * MIN);
    store.advanceClock(now);
    expect(store.state('9102')).toMatchObject({ status: 'finished', statusSource: 'temporal' });
    provider.willReturn('getEventDetail', batchAt([low], now, true));
    const r = await reconcileLive(provider, store, { sport: 'football', now });
    expect(r).toMatchObject({ pending: 1, checked: ['9102'], calls: 1 });
    expect(store.state('9102')).toMatchObject({ status: 'finished', statusSource: 'provider' });
    expect(store.state('9102')!.score).not.toBeNull();

    // confirmado: não gasta de novo
    const again = await reconcileLive(provider, store, {
      sport: 'football',
      now: new Date(now.getTime() + 10 * MIN),
    });
    expect(again).toMatchObject({ pending: 0, calls: 0 });
  });

  it('com o relógio dos eventos: ao vivo caiu perto do fim, o relógio encerra antes dos 30 min de parado e a reconciliação confirma', async () => {
    const { store, provider } = setup([match]);
    // última observação do poller aos 100 min (o processo caiu)
    await store.applyBatch(batchAt([match], new Date(kick + 100 * MIN)));
    const now = new Date(kick + 120 * MIN);
    store.advanceClock(now);
    expect(store.state('9101')).toMatchObject({ status: 'finished', statusSource: 'temporal' });
    provider.willReturn('getEventDetail', batchAt([match], new Date(kick + 130 * MIN), true));
    const r = await reconcileLive(provider, store, { sport: 'football', now });
    expect(r).toMatchObject({ checked: ['9101'], calls: 1 });
    expect(store.state('9101')).toMatchObject({
      status: 'finished',
      statusSource: 'provider',
      statusDetail: 'FT',
    });
  });

  it('parado: só o que o ao vivo acompanha e já viu depois do apito; respeita o intervalo do plano e o orçamento', () => {
    const base: LiveCandidate = {
      eventId: 'ev-1',
      providerEventId: '1',
      sport: 'football',
      competitionId: null,
      providerCompetitionId: '71',
      seasonId: null,
      startsAt: new Date(kick),
      status: 'live',
      statusSource: 'provider',
      statusDetail: '2H',
      clock: null,
      score: null,
      lastValidAt: new Date(kick + 50 * MIN),
      tier: 1,
      livePriority: 'high',
      stageKind: null,
      derby: false,
      importance: 0,
      label: null,
    };
    const at = (m: number) => new Date(kick + m * MIN);
    expect(reconcileReason(base, at(79))).toBeNull();
    expect(reconcileReason(base, at(80))).toBe('stale');
    // cota apertada: o plano está em 25 min por tick → só depois de 50 min sem observação
    expect(reconcileReason(base, at(80), { planIntervalMs: 25 * MIN })).toBeNull();
    expect(reconcileReason(base, at(100), { planIntervalMs: 25 * MIN })).toBe('stale');
    // orçamento LIVE esgotado: não gasta com "parado" (o relógio encerra e ele volta como não confirmado)
    expect(reconcileReason(base, at(100), { liveBudgetExhausted: true })).toBeNull();
    // nunca visto depois do apito (a última observação é a agenda do sync): espera o relógio encerrar
    const unseen = {
      ...base,
      status: 'live' as const,
      statusSource: 'temporal' as const,
      lastValidAt: at(-600),
    };
    expect(reconcileReason(unseen, at(100))).toBeNull();
    // fora do ao vivo (prioridade baixa): idem, mesmo parado; com LIVE_MIN_PRIORITY=low, entra
    const low = { ...base, livePriority: 'low' as const };
    expect(reconcileReason(low, at(100))).toBeNull();
    expect(reconcileReason(low, at(100), { minPriority: 'low' })).toBe('stale');
    // encerrado pelo relógio: sempre, em qualquer prioridade; da fonte, nunca
    const clock = { ...low, status: 'finished' as const, statusSource: 'temporal' as const };
    expect(reconcileReason(clock, at(120))).toBe('unconfirmed');
    expect(reconcileReason({ ...clock, statusSource: 'provider' }, at(120), { force: true })).toBeNull();
    expect(reconcileTargets([{ ...clock, statusSource: 'provider' }], at(120), { force: true })).toEqual([]);
    // botão de pânico: todo jogo em andamento
    expect(reconcileReason(low, at(10), { force: true })).toBe('forced');
    expect(reconcileTargets([low], at(90))).toEqual([]);
    expect(reconcileTargets([low, clock], at(90), { force: true })).toEqual([low, clock]);
  });
});
