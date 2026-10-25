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

  it('agendada: fora do ao vivo (prioridade baixa), só depois do fim previsto do jogo', () => {
    const base: LiveCandidate = {
      eventId: 'ev-1',
      providerEventId: '1',
      sport: 'football',
      competitionId: null,
      providerCompetitionId: '99',
      seasonId: null,
      startsAt: new Date(kick),
      status: 'live',
      statusDetail: '2H',
      clock: null,
      score: null,
      lastValidAt: null,
      tier: 3,
      livePriority: 'low',
      stageKind: null,
      derby: false,
      importance: 0,
      label: null,
    };
    const at = (m: number) => new Date(kick + m * MIN);
    // o relógio marca "ao vivo" pelo horário: no meio do jogo não vale a chamada
    expect(reconcileReason(base, at(90))).toBeNull();
    // passou do fim previsto (apito + 130 min) e ninguém confirmou: confere
    expect(reconcileReason(base, at(131))).toBe('overdue');
    // conferido há pouco (ainda em andamento): espera a próxima janela de "parado"
    expect(reconcileReason({ ...base, lastValidAt: at(131) }, at(141))).toBeNull();
    expect(reconcileReason({ ...base, lastValidAt: at(131) }, at(161))).toBe('overdue');
    // com LIVE_MIN_PRIORITY=low o ao vivo acompanha a liga: vale o critério de "parado"
    expect(reconcileReason(base, at(31), { minPriority: 'low' })).toBe('stale');
    expect(reconcileReason(base, at(29), { minPriority: 'low' })).toBeNull();
    // relevante começando: conta do apito oficial (a agenda do sync é de antes do jogo)
    const starting = { ...base, livePriority: 'high' as const, status: 'starting' as const };
    expect(reconcileReason({ ...starting, lastValidAt: at(-600) }, at(20))).toBeNull();
    expect(reconcileReason({ ...starting, lastValidAt: at(-600) }, at(30))).toBe('stale');
    // botão de pânico: tudo
    expect(reconcileReason(base, at(10), { force: true })).toBe('forced');
    expect(reconcileTargets([base], at(90))).toEqual([]);
    expect(reconcileTargets([base], at(90), { force: true })).toEqual([base]);
  });
});
