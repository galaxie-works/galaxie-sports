import { FakeProvider, normalizeFixtures, type NormalizedBatch } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { apiFixture, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { InMemoryLiveStore } from './memory-store.js';
import { reconcileLive, reconcileTargets } from './reconcile.js';

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
    const r = await reconcileLive(provider, store, { sport: 'football', now, max: 1 });
    expect(r).toMatchObject({ pending: 2, checked: ['9101'], calls: 1 });
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
    );
    expect(targets.map((t: { status: string }) => t.status)).toEqual(['live', 'starting']);
  });
});
