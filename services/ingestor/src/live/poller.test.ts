import { FakeProvider, normalizeFixtures, type NormalizedBatch } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { apiFixture, cupFinal, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { InMemoryLiveStore } from './memory-store.js';
import { TickFencedError } from './leader-epoch.js';
import { LivePoller } from './poller.js';
import type { LiveCandidate } from './types.js';

const MIN = 60_000;
const ids = new Map<string, number>();
const teamId = (name: string) => {
  if (!ids.has(name)) ids.set(name, 5000 + ids.size);
  return ids.get(name)!;
};

function batchAt(matches: WorldMatch[], at: Date, detail = false): NormalizedBatch {
  return normalizeFixtures(
    matches.map((m) => ({
      ...apiFixture(m, at, teamId),
      ...(detail ? { lineups: [], statistics: [] } : {}),
    })),
    at,
  );
}

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
  const provider = new FakeProvider('api-sports');
  const finishedIds: string[] = [];
  const poller = new LivePoller(provider, store, {
    sport: 'football',
    jobId: 'job-run:teste',
    onDetailFetched: (id) => {
      finishedIds.push(id);
    },
  });
  const tracked = async (at: Date): Promise<LiveCandidate[]> =>
    store.candidates(
      'football',
      'api-sports',
      new Date(at.getTime() - 86_400_000),
      new Date(at.getTime() + 86_400_000),
    );
  return { store, provider, poller, tracked, finishedIds };
}

describe('LivePoller', () => {
  const match = wednesdayNight()[3]!; // Palmeiras x Corinthians, 22:00 UTC, gols aos 21' e 90'
  const kick = match.kickoff.getTime();

  it('uma chamada listLive com prioridade LIVE; aplica placar e publica o gol', async () => {
    const { store, provider, poller, tracked } = setup([match]);
    const t1 = new Date(kick + 15 * MIN);
    const t2 = new Date(kick + 25 * MIN);
    provider.willReturn('listLive', batchAt([match], t1)).willReturn('listLive', batchAt([match], t2));

    const r1 = await poller.tick({ now: t1, leagues: ['71'], tracked: await tracked(t1), finalizeBudget: 1 });
    expect(provider.calls[0]).toEqual({
      method: 'listLive',
      args: ['football', ['71'], { priority: 'LIVE', jobId: 'job-run:teste' }],
    });
    expect(r1).toMatchObject({ outcome: 'ok', events: 1, calls: 1, vanished: [] });
    expect(r1.changes[0]!.kinds).toContain('status');

    const r2 = await poller.tick({ now: t2, leagues: ['71'], tracked: await tracked(t2), finalizeBudget: 1 });
    const goal = r2.changes.find((c) => c.goal)!;
    expect(goal.score).toMatchObject({ home: 1, away: 0 });
    expect(goal.incidents).toHaveLength(1);
    expect(store.published.filter((c) => c.goal)).toHaveLength(1);
  });

  it('falha da fonte: last-known-good (stale) sem inventar placar', async () => {
    const { store, provider, poller, tracked } = setup([match]);
    const t1 = new Date(kick + 30 * MIN);
    provider.willReturn('listLive', batchAt([match], t1));
    await poller.tick({ now: t1, leagues: ['71'], tracked: await tracked(t1), finalizeBudget: 0 });

    const t2 = new Date(kick + 40 * MIN);
    provider.willFail('listLive', { kind: 'http_error', message: 'HTTP 503', retryable: true }, t2);
    const r = await poller.tick({ now: t2, leagues: ['71'], tracked: await tracked(t2), finalizeBudget: 0 });
    expect(r).toMatchObject({ outcome: 'error', staleMarked: 1, calls: 1 });
    expect(store.state('9101')).toMatchObject({ isStale: true, status: 'live', score: { home: 1, away: 0 } });
    expect(r.changes[0]!.kinds).toEqual(['stale']);

    // cota negada pelo Governor não sai para a rede
    provider.willFail('listLive', { kind: 'quota', message: 'cota', retryable: false }, t2);
    const q = await poller.tick({ now: t2, leagues: ['71'], tracked: await tracked(t2), finalizeBudget: 0 });
    expect(q.calls).toBe(0);
  });

  it('jogo que some do live é confirmado pelo detalhe (e só ele gasta a chamada extra)', async () => {
    const other = wednesdayNight()[4]!; // Bahia x Fortaleza, mesma liga, começa 4 min depois
    const { store, provider, poller, tracked, finishedIds } = setup([match, other]);
    const t1 = new Date(kick + 100 * MIN);
    provider.willReturn('listLive', batchAt([match, other], t1));
    await poller.tick({ now: t1, leagues: ['71'], tracked: await tracked(t1), finalizeBudget: 2 });

    const t2 = new Date(kick + 111 * MIN); // Palmeiras x Corinthians acabou (FT), o outro segue
    provider
      .willReturn('listLive', batchAt([other], t2))
      .willReturn('getEventDetail', batchAt([match], t2, true));
    const r = await poller.tick({ now: t2, leagues: ['71'], tracked: await tracked(t2), finalizeBudget: 2 });
    expect(r.vanished).toEqual(['9101']);
    expect(r.finalized).toEqual(['9101']);
    expect(r.calls).toBe(2);
    expect(provider.calls.at(-1)).toEqual({
      method: 'getEventDetail',
      args: ['football', '9101', { priority: 'LIVE', jobId: 'job-run:teste' }],
    });
    expect(store.state('9101')).toMatchObject({
      status: 'finished',
      statusDetail: 'FT',
      score: { home: 1, away: 1 },
    });
    expect(finishedIds).toEqual(['9101']);
    expect(store.finished.map((c) => c.providerEventId)).toEqual(['9101']);
    expect(store.state('9102')!.status).toBe('live');
  });

  it('detalhe ainda sem o apito final: tenta de novo com espera, sem desistir no mesmo minuto', async () => {
    const { store, provider, poller, tracked, finishedIds } = setup([match]);
    const at = (min: number) => new Date(kick + min * MIN);
    const tick = async (now: Date) =>
      poller.tick({ now, leagues: ['71'], tracked: await tracked(now), finalizeBudget: 2 });
    const details = () => provider.calls.filter((c) => c.method === 'getEventDetail').length;

    provider.willReturn('listLive', batchAt([match], at(100)));
    await tick(at(100));

    // saiu do live, mas o detalhe ainda diz 2º tempo (a fonte atrasa o FT)
    provider
      .willReturn('listLive', batchAt([], at(101)))
      .willReturn('getEventDetail', batchAt([match], at(100), true));
    const r1 = await tick(at(101));
    expect(r1).toMatchObject({ vanished: ['9101'], finalized: [] });
    expect(store.state('9101')!.status).toBe('live');

    // 30 s depois: ainda na espera, nenhuma chamada de detalhe
    provider.willReturn('listLive', batchAt([], at(101.5)));
    await tick(at(101.5));
    expect(details()).toBe(1);

    // depois da espera: o detalhe confirma o encerramento
    provider
      .willReturn('listLive', batchAt([], at(102.5)))
      .willReturn('getEventDetail', batchAt([match], at(111), true));
    const r2 = await tick(at(102.5));
    expect(details()).toBe(2);
    expect(r2.finalized).toEqual(['9101']);
    expect(store.state('9101')).toMatchObject({ status: 'finished', statusDetail: 'FT' });
    expect(finishedIds).toEqual(['9101']);
  });

  it('sem orçamento de confirmação, o jogo que sumiu fica para o próximo tick', async () => {
    const { provider, poller, tracked } = setup([match]);
    const t1 = new Date(kick + 100 * MIN);
    provider.willReturn('listLive', batchAt([match], t1));
    await poller.tick({ now: t1, leagues: ['71'], tracked: await tracked(t1), finalizeBudget: 0 });
    const t2 = new Date(kick + 112 * MIN);
    provider.willReturn('listLive', batchAt([], t2));
    const r = await poller.tick({ now: t2, leagues: ['71'], tracked: await tracked(t2), finalizeBudget: 0 });
    expect(r).toMatchObject({ outcome: 'empty', vanished: ['9101'], finalized: [], calls: 1 });
    expect(provider.calls.filter((c) => c.method === 'getEventDetail')).toHaveLength(0);
  });

  it('detalhe ao vivo do jogo em destaque quando o plano permite', async () => {
    const final = cupFinal();
    const { provider, poller, tracked, finishedIds } = setup([final]);
    const t1 = new Date(final.kickoff.getTime() + 20 * MIN);
    provider
      .willReturn('listLive', batchAt([final], t1))
      .willReturn('getEventDetail', batchAt([final], t1, true));
    const live = await tracked(t1);
    const r0 = await poller.tick({ now: t1, leagues: ['73'], tracked: live, finalizeBudget: 0 });
    expect(r0.featured).toBeUndefined();
    const live2 = await tracked(t1);
    provider.willReturn('listLive', batchAt([final], t1));
    const r = await poller.tick({
      now: t1,
      leagues: ['73'],
      tracked: live2,
      featured: live2[0],
      finalizeBudget: 0,
    });
    expect(r.featured).toBe('9500');
    expect(r.calls).toBe(2);
    expect(finishedIds).toEqual([]); // ainda em andamento: o cursor do detalhe não é marcado
  });

  describe('líder e reserva', () => {
    const at = (min: number) => new Date(kick + min * MIN);
    const details = (provider: FakeProvider) =>
      provider.calls.filter((c) => c.method === 'getEventDetail').length;

    it('a nova líder herda as tentativas de confirmar o resultado: não repete a chamada da antiga', async () => {
      const { store, provider, poller, tracked } = setup([match]);
      provider.willReturn('listLive', batchAt([match], at(100)));
      await poller.tick({
        now: at(100),
        leagues: ['71'],
        tracked: await tracked(at(100)),
        finalizeBudget: 2,
      });
      // sumiu do live, e o detalhe ainda não diz que acabou
      provider
        .willReturn('listLive', batchAt([], at(101)))
        .willReturn('getEventDetail', batchAt([match], at(100), true));
      await poller.tick({
        now: at(101),
        leagues: ['71'],
        tracked: await tracked(at(101)),
        finalizeBudget: 2,
      });
      expect(details(provider)).toBe(1);

      const successor = new LivePoller(provider, store, { sport: 'football' });
      successor.restoreFinalizeAttempts(
        JSON.parse(JSON.stringify(poller.exportFinalizeAttempts(at(101)))) as Record<
          string,
          { attempts: number; nextAt: number }
        >,
      );
      // dentro do backoff de 1 min da antiga: nada
      provider.willReturn('listLive', batchAt([], at(101.5)));
      await successor.tick({
        now: at(101.5),
        leagues: ['71'],
        tracked: await tracked(at(101.5)),
        finalizeBudget: 2,
      });
      expect(details(provider)).toBe(1);
      // passado o backoff: agora sim
      provider
        .willReturn('listLive', batchAt([], at(102)))
        .willReturn('getEventDetail', batchAt([match], at(112), true));
      await successor.tick({
        now: at(102),
        leagues: ['71'],
        tracked: await tracked(at(102)),
        finalizeBudget: 2,
      });
      expect(details(provider)).toBe(2);
    });

    it('o bastão esquece tentativas de mais de um dia', async () => {
      const { poller } = setup([match]);
      poller.restoreFinalizeAttempts({
        velho: { attempts: 3, nextAt: 0 },
        novo: { attempts: 1, nextAt: 1_000 },
      });
      expect(Object.keys(poller.exportFinalizeAttempts(new Date(1_000)))).toEqual(['velho', 'novo']);
      expect(Object.keys(poller.exportFinalizeAttempts(new Date(24 * 60 * MIN + 500)))).toEqual(['novo']);
    });

    it('trava perdida antes do tick: nenhuma chamada', async () => {
      const { provider, poller, tracked } = setup([match]);
      const fence = AbortSignal.abort();
      await expect(
        poller.tick({
          now: at(15),
          leagues: ['71'],
          tracked: await tracked(at(15)),
          finalizeBudget: 1,
          fence,
        }),
      ).rejects.toBeInstanceOf(TickFencedError);
      expect(provider.calls).toHaveLength(0);
    });

    it('trava perdida com a chamada no ar: descarta a resposta, sem gravar nem publicar', async () => {
      const { store, provider, poller, tracked } = setup([match]);
      const list = await tracked(at(25));
      provider.willReturn('listLive', batchAt([match], at(25)));
      const fence = new AbortController();
      const listLive = provider.listLive.bind(provider);
      provider.listLive = async (...args) => {
        const result = await listLive(...args);
        fence.abort();
        return result;
      };
      await expect(
        poller.tick({ now: at(25), leagues: ['71'], tracked: list, finalizeBudget: 1, fence: fence.signal }),
      ).rejects.toBeInstanceOf(TickFencedError);
      expect(store.state('9101')).toMatchObject({ status: 'scheduled' });
      expect(store.published).toHaveLength(0);
    });

    it('trava perdida entre as chamadas de detalhe: nenhuma chamada nova e nada gravado', async () => {
      const { store, provider, poller, tracked } = setup([match]);
      provider.willReturn('listLive', batchAt([match], at(100)));
      const first = await tracked(at(100));
      await poller.tick({ now: at(100), leagues: ['71'], tracked: first, finalizeBudget: 1 });
      const batches = store.batches;
      const published = store.published.length;

      // sumiu do live; a trava cai com a primeira confirmação no ar
      const fence = new AbortController();
      const later = await tracked(at(111));
      provider
        .willReturn('listLive', batchAt([], at(111)))
        .willReturn('getEventDetail', batchAt([match], at(111), true));
      const detail = provider.getEventDetail.bind(provider);
      provider.getEventDetail = async (...args) => {
        const result = await detail(...args);
        fence.abort();
        return result;
      };
      await expect(
        poller.tick({
          now: at(111),
          leagues: ['71'],
          tracked: later,
          finalizeBudget: 2,
          fence: fence.signal,
        }),
      ).rejects.toBeInstanceOf(TickFencedError);
      expect(store.batches).toBe(batches);
      expect(store.published).toHaveLength(published);
    });

    it('banco recusou a época: o tick não grava nem publica, e o erro chega a quem chamou', async () => {
      const { store, provider, poller, tracked } = setup([match]);
      provider.willReturn('listLive', batchAt([match], at(25)));
      const list = await tracked(at(25));
      store.atomic = () => Promise.reject(new TickFencedError());
      await expect(
        poller.tick({ now: at(25), leagues: ['71'], tracked: list, finalizeBudget: 1 }),
      ).rejects.toBeInstanceOf(TickFencedError);
      expect(store.batches).toBe(0);
      expect(store.published).toHaveLength(0);
    });
  });
});
