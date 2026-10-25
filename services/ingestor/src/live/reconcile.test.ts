import { batchResult, FakeProvider, normalizeFixtures, type NormalizedBatch } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { apiFixture, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { InMemoryCursorStore } from '../jobs/runtime/cursor-store.js';
import { InMemoryLiveStore } from './memory-store.js';
import {
  adhocAllowance,
  LIST_EVERY_MS,
  quotaSkipsToWarn,
  reconcileLive,
  SCHEDULE_SLACK_MS,
  reconcileReason,
  reconcileTargets,
  UNCONFIRMED_MAX_ATTEMPTS,
  unconfirmedDue,
} from './reconcile.js';
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

  it('relógio: fora de uma agenda com jogos conta como encerrado por ora — 1 chamada só', async () => {
    const someoneElse = batchAt([wednesdayNight()[0]!], new Date(kick + 300 * MIN));
    const r = await simulateDay(lowMatch, (p) => p.willReturn('listEvents', someoneElse));
    expect(r.calls).toBe(1);
  });

  it('relógio: agenda mundial vazia é falha da fonte — tenta de novo, espaçado, até 3 vezes', async () => {
    const empty = normalizeFixtures([], new Date(kick));
    const r = await simulateDay(lowMatch, (p) => p.willReturn('listEvents', empty));
    expect(r.calls).toBe(UNCONFIRMED_MAX_ATTEMPTS);
  });

  it('relógio: jogo remarcado para outra data volta para a agenda nova', async () => {
    const moved = { ...lowMatch, kickoff: new Date(lowMatch.kickoff.getTime() + 86_400_000) };
    const r = await simulateDay(lowMatch, (p) =>
      p.willReturn('listEvents', batchAt([moved], new Date(lowMatch.kickoff.getTime() + 3 * 3_600_000))),
    );
    expect(r.calls).toBe(1);
    expect(r.store.state('9102')).toMatchObject({ status: 'scheduled', startsAt: moved.kickoff });
  });

  it('tentativas: a 2ª depois de 30 min, a 3ª depois de 2 h (com 5 min de folga para o atraso do cron), e para', () => {
    const t0 = new Date(kick);
    const after = (n: number) => ({
      completedAt: null,
      cursor: { attempts: n, lastAttemptAt: t0.toISOString() },
    });
    const at = (min: number) => new Date(kick + min * MIN);
    expect(unconfirmedDue(undefined, t0)).toBe(true);
    expect(unconfirmedDue(after(1), at(24))).toBe(false);
    expect(unconfirmedDue(after(1), at(25))).toBe(true);
    expect(unconfirmedDue(after(2), at(114))).toBe(false);
    expect(unconfirmedDue(after(2), at(115))).toBe(true);
    expect(unconfirmedDue(after(3), at(10_000))).toBe(false);
    expect(unconfirmedDue({ completedAt: t0, cursor: null }, at(10_000))).toBe(false);
  });

  it('cota: bloqueio local (cota/plano) não conta tentativa nem lote — tenta de novo na próxima execução', async () => {
    const { store, provider, cursors } = setup([lowMatch]);
    const k = lowMatch.kickoff.getTime();
    const now = new Date(k + 130 * MIN);
    store.advanceClock(now);
    provider.willFail('listEvents', { kind: 'quota', message: 'cota ADHOC', retryable: true }, now);
    const r = await reconcileLive(provider, store, { cursors, sport: 'football', now });
    expect(r).toMatchObject({
      calls: 0,
      listed: [],
      listSkipped: [{ date: '2026-10-21', reason: 'quota', games: 1 }],
    });
    expect([...cursors.rows.values()]).toEqual([]);
    // 10 min depois, com cota: confere (sem esperar o espaçamento)
    const later = new Date(now.getTime() + 10 * MIN);
    provider.willReturn('listEvents', batchAt([lowMatch], later));
    const r2 = await reconcileLive(provider, store, { cursors, sport: 'football', now: later });
    expect(r2).toMatchObject({ calls: 1, confirmedByList: ['9102'] });
  });

  it('sábado com 22 horários: no máximo 1 agenda por data a cada 60 min, e nunca além da fatia ADHOC', async () => {
    const slots = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '16:00']
      .concat(['16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'])
      .concat(['21:30', '22:00']);
    const matches: WorldMatch[] = slots.flatMap((hhmm, i) =>
      [0, 1, 2].map((j) => ({
        ...lowMatch,
        fixtureId: 50_000 + i * 3 + j,
        leagueId: 900 + j,
        home: `Casa ${i}-${j}`,
        away: `Fora ${i}-${j}`,
        kickoff: new Date(`2026-10-24T${hhmm}:00Z`),
        goals: [],
      })),
    );
    const run = async (adhoc: number | undefined) => {
      const { store, cursors } = setup(matches);
      const listCalls: Date[] = [];
      const skipped: string[] = [];
      let now = new Date('2026-10-24T10:00:00Z');
      const provider = new FakeProvider('api-sports');
      provider.listEvents = async () => {
        listCalls.push(now);
        const done = matches.filter((m) => now.getTime() - m.kickoff.getTime() > 115 * MIN);
        const batch = normalizeFixtures(
          done.map((m) => apiFixture(m, new Date(m.kickoff.getTime() + 200 * MIN), teamId)),
          now,
        );
        return batchResult(batch, 'network', done.length);
      };
      let left = adhoc;
      for (let t = 0; t < 15 * 60; t++) {
        now = new Date(Date.parse('2026-10-24T10:00:00Z') + t * MIN);
        store.advanceClock(now);
        if (t % 10) continue;
        const r = await reconcileLive(provider, store, {
          cursors,
          sport: 'football',
          now,
          adhocAvailable: left,
        });
        if (left !== undefined) left -= r.listed.length;
        skipped.push(...r.listSkipped.map((x) => x.reason));
      }
      return { listCalls, skipped, store };
    };

    const uncapped = await run(undefined);
    // 15 h de simulação (10:00 → 01:00): ≤ 1 por hora (antes, uma a cada execução com jogo devido: 21)
    expect(uncapped.listCalls.length).toBeLessThanOrEqual(15);
    for (let i = 1; i < uncapped.listCalls.length; i++)
      expect(uncapped.listCalls[i]!.getTime() - uncapped.listCalls[i - 1]!.getTime()).toBeGreaterThanOrEqual(
        LIST_EVERY_MS - SCHEDULE_SLACK_MS,
      );
    // todos confirmados pela fonte até a 01:00
    const confirmed = matches.filter(
      (m) => uncapped.store.state(String(m.fixtureId))!.statusSource === 'provider',
    );
    expect(confirmed.length).toBe(matches.length);

    // plano gratuito: fatia ADHOC de 5 (− 1 de margem) → 4 agendas, o resto avisado e deixado para o sync D-1
    const capped = await run(adhocAllowance({ used: { ADHOC: 0 }, budget: { ADHOC: 5 } }));
    expect(capped.listCalls).toHaveLength(4);
    expect(capped.skipped.length).toBeGreaterThan(0);
    expect(new Set(capped.skipped)).toEqual(new Set(['adhoc_budget']));
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

  it('remarcado no mesmo dia (+150 min): volta para a agenda e, encerrado de novo pelo relógio, é conferido', async () => {
    const g = { ...lowMatch, kickoff: new Date('2026-10-24T12:00:00Z') };
    const moved = { ...g, kickoff: new Date('2026-10-24T14:30:00Z') };
    const { store, cursors } = setup([g]);
    let now = new Date(g.kickoff);
    const calls: string[] = [];
    const provider = new FakeProvider('api-sports');
    provider.listEvents = async () => {
      calls.push(now.toISOString().slice(11, 16));
      const over = now.getTime() - moved.kickoff.getTime() > 115 * MIN;
      const at = new Date(moved.kickoff.getTime() + (over ? 200 : -60) * MIN);
      return batchResult(normalizeFixtures([apiFixture(moved, at, teamId)], now), 'network', 1);
    };
    for (let t = 0; t <= 10 * 60; t++) {
      now = new Date(g.kickoff.getTime() + t * MIN);
      store.advanceClock(now);
      if (t % 10) continue;
      await reconcileLive(provider, store, { cursors, sport: 'football', now });
    }
    // 1º lote: remarcado para 14:30; o relógio o encerra de novo às 16:25 e o lote seguinte confirma
    expect(calls).toEqual(['14:00', '16:30']);
    expect(store.state(String(g.fixtureId))).toMatchObject({
      status: 'finished',
      statusSource: 'provider',
      startsAt: moved.kickoff,
    });
  });

  it('cron com segundos de atraso: o lote de hora em hora não escorrega e cabem as 3 tentativas', async () => {
    // G às 12:00 e H às 11:50 (o lote de H sai antes de G vencer); a fonte sempre falha
    const g = { ...lowMatch, fixtureId: 61, kickoff: new Date('2026-10-24T12:00:00Z') };
    const h = { ...lowMatch, fixtureId: 62, kickoff: new Date('2026-10-24T11:50:00Z') };
    const { store, provider, cursors } = setup([g, h]);
    const jitter = [5, 1, 4, 2, 6, 0, 3];
    let k = 0;
    for (let t = 0; t <= 9 * 60; t++) {
      const tick = g.kickoff.getTime() + t * MIN;
      store.advanceClock(new Date(tick));
      if (t % 10) continue;
      const now = new Date(tick + jitter[k++ % jitter.length]! * 1000);
      provider.willFail('listEvents', { kind: 'http_error', message: '503', retryable: true }, now);
      await reconcileLive(provider, store, { cursors, sport: 'football', now });
      (provider as unknown as { queues: Map<string, unknown[]> }).queues.clear();
    }
    const attempts = [...cursors.rows.values()]
      .filter((r) => r.ref.key.startsWith('id='))
      .map((r) => [r.ref.key.split('@')[0], r.cursor?.attempts]);
    expect(attempts.sort()).toEqual([
      ['id=61', UNCONFIRMED_MAX_ATTEMPTS],
      ['id=62', UNCONFIRMED_MAX_ATTEMPTS],
    ]);
  });

  it('limite por minuto (ou a mesma agenda em voo noutro processo) não conta tentativa nem lote', async () => {
    const { store, provider, cursors } = setup([lowMatch]);
    const now = new Date(lowMatch.kickoff.getTime() + 130 * MIN);
    store.advanceClock(now);
    provider.willFail('listEvents', { kind: 'rate_limited', message: 'em voo', retryable: true }, now);
    const r = await reconcileLive(provider, store, { cursors, sport: 'football', now });
    expect(r.listSkipped).toEqual([{ date: '2026-10-21', reason: 'rate_limited', games: 1 }]);
    expect([...cursors.rows.values()]).toEqual([]);
  });

  it('aviso de falta de cota: 1× por data e por dia; 429/agenda em voo não avisa nem gasta o aviso', async () => {
    const cursors = new InMemoryCursorStore();
    const now = new Date('2026-10-24T15:00:00Z');
    const limited = [{ date: '2026-10-24', reason: 'rate_limited' as const, games: 3 }];
    expect(await quotaSkipsToWarn(cursors, 'football', limited, now)).toEqual([]);
    expect([...cursors.rows.values()]).toEqual([]);
    // mais tarde, a fatia ADHOC acaba: o aviso real sai (o 429 não o escondeu)
    const budget = [{ date: '2026-10-24', reason: 'adhoc_budget' as const, games: 3 }];
    const later = new Date(now.getTime() + 60 * MIN);
    expect(await quotaSkipsToWarn(cursors, 'football', budget, later)).toEqual(budget);
    expect(await quotaSkipsToWarn(cursors, 'football', budget, new Date(later.getTime() + 10 * MIN))).toEqual(
      [],
    );
    // no dia seguinte, avisa de novo
    expect(await quotaSkipsToWarn(cursors, 'football', budget, new Date('2026-10-25T01:00:00Z'))).toEqual(
      budget,
    );
  });
});
