import { FakeProvider, normalizeFixtures, type NormalizedBatch } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { apiFixture, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { InMemoryCursorStore } from '../jobs/runtime/cursor-store.js';
import { InMemoryLiveStore } from './memory-store.js';
import { reconcileLive, reconcileReason, reconcileTargets, UNCONFIRMED_MAX_ATTEMPTS } from './reconcile.js';
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
  return { store, provider: new FakeProvider('api-sports'), cursors: new InMemoryCursorStore() };
}

describe('reconcileLive', () => {
  const [match, other] = [wednesdayNight()[3]!, wednesdayNight()[4]!];
  const kick = match.kickoff.getTime();

  it('confirma pelo detalhe quem o core ainda dá como em andamento e encerra o que acabou', async () => {
    const { store, provider, cursors } = setup([match, other]);
    // o ao vivo viu os dois em andamento e depois parou de acompanhar (processo caiu, desistiu, etc.)
    await store.applyBatch(batchAt([match, other], new Date(kick + 100 * MIN)));
    expect(store.state('9101')!.status).toBe('live');

    const now = new Date(kick + 130 * MIN);
    provider
      .willReturn('getEventDetail', batchAt([match], now, true))
      .willReturn('getEventDetail', batchAt([other], now, true));
    const fetched: string[] = [];
    const r = await reconcileLive(provider, store, {
      cursors,
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

  it('respeita o máximo de chamadas, pela prioridade', async () => {
    const { store, provider, cursors } = setup([match, other]);
    await store.applyBatch(batchAt([match, other], new Date(kick + 60 * MIN)));
    const now = new Date(kick + 70 * MIN);
    provider.willReturn('getEventDetail', batchAt([match], now, true));
    const r = await reconcileLive(provider, store, { cursors, sport: 'football', now, max: 1, force: true });
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
    const { store, provider, cursors } = setup([match, low]);
    // o poller atualizou o jogo principal há 5 min; o de prioridade baixa (fora do ao vivo) nunca foi visto
    await store.applyBatch(batchAt([match], new Date(kick + 55 * MIN)));
    const now = new Date(kick + 60 * MIN);
    const r = await reconcileLive(provider, store, { cursors, sport: 'football', now });
    expect(r).toMatchObject({ inPlay: 1, pending: 0, checked: [], calls: 0 });
    expect(provider.calls).toHaveLength(0);

    // o ao vivo parou (processo caiu): 30 min sem observação válida → suspeito, confere
    const later = new Date(kick + 85 * MIN);
    provider.willReturn('getEventDetail', batchAt([match], later, true));
    const r2 = await reconcileLive(provider, store, { cursors, sport: 'football', now: later });
    expect(r2).toMatchObject({ pending: 1, checked: ['9101'], calls: 1 });
  });

  /** Simula o dia: relógio dos eventos a cada minuto e a reconciliação agendada a cada 10 min, por 6 h. */
  async function simulateDay(
    m: WorldMatch,
    answer: (provider: FakeProvider, now: Date) => void,
  ): Promise<{ calls: number; statuses: string[]; provider: FakeProvider; store: InMemoryLiveStore }> {
    const { store, provider, cursors } = setup([m]);
    const k = m.kickoff.getTime();
    const statuses: string[] = [];
    let calls = 0;
    for (let t = 0; t <= 6 * 60; t++) {
      const now = new Date(k + t * MIN);
      store.advanceClock(now);
      const s = store.state(String(m.fixtureId))!;
      if (statuses.at(-1) !== `${s.status}/${s.statusSource}`) statuses.push(`${s.status}/${s.statusSource}`);
      if (t % 10 !== 0) continue;
      answer(provider, now);
      calls += (await reconcileLive(provider, store, { cursors, sport: 'football', now })).calls;
      (provider as unknown as { queues: Map<string, unknown[]> }).queues.clear();
    }
    return { calls, statuses, provider, store };
  }
  const lowMatch = { ...other, livePriority: 'low' as const, derby: false };

  it('relógio: jogo do catálogo fora do ao vivo, nunca observado, é confirmado uma vez pela agenda do dia (ADHOC)', async () => {
    const r = await simulateDay(lowMatch, (p, now) =>
      p.willReturn('listEvents', batchAt([lowMatch], new Date(now.getTime() + 60 * MIN))),
    );
    // no meio do jogo o relógio marca "ao vivo": nada é chamado; no encerramento pelo relógio, 1 agenda
    expect(r.calls).toBe(1);
    expect(r.provider.calls[0]).toEqual({
      method: 'listEvents',
      args: [{ sport: 'football', date: lowMatch.kickoff.toISOString().slice(0, 10) }, { priority: 'ADHOC' }],
    });
    expect(r.statuses).toEqual(['live/temporal', 'finished/temporal', 'finished/provider']);
    expect(r.store.state('9102')!.score).not.toBeNull();
    expect(r.store.finished.map((c) => c.providerEventId)).toEqual(['9102']);
  });

  it('relógio: a fonte diz "não começou" (NS travado) — não reabre o jogo e desiste depois de 3 tentativas espaçadas', async () => {
    const ns = batchAt([lowMatch], new Date(lowMatch.kickoff.getTime() - 60 * MIN));
    const r = await simulateDay(lowMatch, (p) => p.willReturn('listEvents', ns));
    expect(r.calls).toBe(UNCONFIRMED_MAX_ATTEMPTS);
    // sem piscar finished → starting → finished: fica encerrado pelo relógio até o sync D-1
    expect(r.statuses).toEqual(['live/temporal', 'finished/temporal']);
    expect(r.store.published).toHaveLength(0);
  });

  it('relógio: fora da agenda do dia (ou agenda vazia) conta como encerrado por ora — 1 chamada só', async () => {
    const empty = normalizeFixtures([], new Date(kick));
    const r = await simulateDay(lowMatch, (p) => p.willReturn('listEvents', empty));
    expect(r.calls).toBe(1);
  });

  it('relógio: fonte com erro tenta de novo espaçado (+30 min, +2 h), no máximo 3 vezes', async () => {
    const r = await simulateDay(lowMatch, (p, now) =>
      p.willFail('listEvents', { kind: 'http_error', message: '503', retryable: true }, now),
    );
    expect(r.calls).toBe(UNCONFIRMED_MAX_ATTEMPTS);
    expect(r.provider.calls.map((c) => c.method)).toEqual(['listEvents', 'listEvents', 'listEvents']);
  });

  it('relógio: jogo fora do catálogo (live_priority none) fica para a agenda D-1 do sync', async () => {
    const none = { ...other, livePriority: 'none' as const, derby: false };
    const r = await simulateDay(none, () => {});
    expect(r.calls).toBe(0);
  });

  it('relógio: vários encerrados no mesmo dia, uma chamada só; o ao vivo caiu perto do fim e o relógio fechou antes dos 30 min', async () => {
    const { store, provider, cursors } = setup([match, other]);
    // última observação do poller aos 100 min (o processo caiu)
    await store.applyBatch(batchAt([match, other], new Date(kick + 100 * MIN)));
    const now = new Date(kick + 120 * MIN);
    store.advanceClock(now);
    expect(store.state('9101')).toMatchObject({ status: 'finished', statusSource: 'temporal' });
    provider.willReturn(
      'listEvents',
      batchAt([match, other, wednesdayNight()[0]!], new Date(kick + 130 * MIN)),
    );
    const r = await reconcileLive(provider, store, { cursors, sport: 'football', now });
    expect(r).toMatchObject({ checked: [], listed: ['2026-10-21'], calls: 1 });
    expect(r.confirmedByList.sort()).toEqual(['9101', '9102']);
    expect(store.state('9101')).toMatchObject({
      status: 'finished',
      statusSource: 'provider',
      statusDetail: 'FT',
    });
    // só os pedidos entram no core (a agenda do dia inteiro não é aplicada)
    expect(store.state('9001')).toBeUndefined();
    expect(r.finished.sort()).toEqual(['9101', '9102']);
  });

  it('mais alvos do que o teto: os parados (pela prioridade) vêm antes, também no --forcar; os encerrados pelo relógio vão no lote', async () => {
    const ucl = wednesdayNight().slice(1, 3); // 19:00 — encerrados pelo relógio às 23:00
    const { store, provider, cursors } = setup([...ucl, match, other]);
    for (const m of ucl) await store.applyBatch(batchAt([m], new Date(m.kickoff.getTime() + 60 * MIN)));
    await store.applyBatch(batchAt([match, other], new Date(kick + 20 * MIN)));
    const now = new Date(kick + 60 * MIN);
    store.advanceClock(now);
    // o relógio fechou os da Champions; os do Brasileirão seguem "ao vivo", parados há 40 min
    expect(store.state('9002')).toMatchObject({ status: 'finished', statusSource: 'temporal' });
    provider
      .willReturn('getEventDetail', batchAt([match], now, true))
      .willReturn('listEvents', batchAt(ucl, now));
    const r = await reconcileLive(provider, store, { cursors, sport: 'football', now, max: 1 });
    // o clássico (maior prioridade) entra no teto; os encerrados pelo relógio, no lote (fora do teto)
    expect(r.checked).toEqual(['9101']);
    expect(r.confirmedByList.sort()).toEqual(['9002', '9003']);

    // --forcar: o que segue parado (9102) vem antes do recém-conferido (9101, agora só "forçado")
    provider.willReturn('getEventDetail', batchAt([other], now, true));
    const forced = await reconcileLive(provider, store, {
      cursors,
      sport: 'football',
      now,
      max: 1,
      force: true,
    });
    expect(forced.checked).toEqual(['9102']);
    expect(forced.listed).toEqual([]);
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
    const unseen = { ...base, statusSource: 'temporal' as const, lastValidAt: at(-600) };
    expect(reconcileReason(unseen, at(100))).toBeNull();
    // fora do ao vivo (prioridade baixa): idem; com LIVE_MIN_PRIORITY=low, entra
    const low = { ...base, livePriority: 'low' as const };
    expect(reconcileReason(low, at(100))).toBeNull();
    expect(reconcileReason(low, at(100), { minPriority: 'low' })).toBe('stale');
    // encerrado pelo relógio: no catálogo, sempre; fora dele (none), nunca; da fonte, nunca
    const clock = { ...low, status: 'finished' as const, statusSource: 'temporal' as const };
    expect(reconcileReason(clock, at(120))).toBe('unconfirmed');
    expect(reconcileReason({ ...clock, livePriority: 'none' }, at(120))).toBeNull();
    expect(reconcileReason({ ...clock, statusSource: 'provider' }, at(120), { force: true })).toBeNull();
    // botão de pânico: todo jogo em andamento (o parado continua "parado", na frente)
    expect(reconcileReason(low, at(10), { force: true })).toBe('forced');
    expect(reconcileReason(base, at(100), { force: true })).toBe('stale');
    expect(reconcileTargets([low], at(90))).toEqual([]);
    expect(reconcileTargets([low, clock], at(90), { force: true })).toEqual([low, clock]);
  });
});
