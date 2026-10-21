import { describe, expect, it } from 'vitest';
import { diffSnapshot, isSignificant, scoreKey, type EventSnapshot } from './diff.js';

const base: EventSnapshot = {
  eventId: 'e1',
  providerEventId: '1',
  competitionId: 'c1',
  seasonId: 's1',
  status: 'live',
  statusDetail: '1H',
  clock: { minute: 10, extra: null, period: '1H' },
  score: { home: 0, away: 0 },
  isStale: false,
  lastValidAt: new Date('2026-10-21T22:10:00Z'),
  incidents: [],
};

describe('diffSnapshot', () => {
  it('sem mudança → null; só relógio → mudança não significativa', () => {
    expect(diffSnapshot(base, { ...base })).toBeNull();
    const clock = diffSnapshot(base, { ...base, clock: { minute: 11, extra: null, period: '1H' } })!;
    expect(clock.kinds).toEqual(['clock']);
    expect(isSignificant(clock)).toBe(false);
  });

  it('gol: placar, incidente novo e sinal de gol', () => {
    const after: EventSnapshot = {
      ...base,
      clock: { minute: 21, extra: null, period: '1H' },
      score: { home: 1, away: 0 },
      incidents: [
        { sequence: 0, type: 'goal', detail: 'Normal Goal', minute: 21, extra: null, participantId: 'p1' },
      ],
    };
    const c = diffSnapshot(base, after)!;
    expect(c.kinds).toEqual(['score', 'clock', 'incident']);
    expect(c).toMatchObject({ goal: true, finished: false, incidents: [{ type: 'goal', minute: 21 }] });
    expect(c.previous).toEqual({ status: 'live', statusDetail: '1H', score: { home: 0, away: 0 } });
  });

  it('VAR anula o gol: incidente removido e placar de volta', () => {
    const withGoal: EventSnapshot = {
      ...base,
      score: { home: 1, away: 0 },
      incidents: [
        { sequence: 0, type: 'goal', detail: 'Normal Goal', minute: 21, extra: null, participantId: 'p1' },
      ],
    };
    const c = diffSnapshot(withGoal, { ...base })!;
    expect(c.kinds).toEqual(['score', 'incident']);
    expect(c.removedIncidents).toBe(1);
  });

  it('encerramento, stale e recuperação', () => {
    const ft = diffSnapshot(base, { ...base, status: 'finished', statusDetail: 'FT' })!;
    expect(ft).toMatchObject({ kinds: ['status'], finished: true });
    const stale = diffSnapshot(base, { ...base, isStale: true })!;
    expect(stale.kinds).toEqual(['stale']);
    expect(isSignificant(stale)).toBe(true);
    expect(diffSnapshot({ ...base, isStale: true }, base)!.kinds).toEqual(['recovered']);
  });

  it('evento novo no core e placar de pênaltis', () => {
    expect(diffSnapshot(undefined, base)!.kinds).toEqual(['created']);
    expect(scoreKey({ home: 2, away: 2, penalty: { home: 4, away: 3 } })).not.toBe(
      scoreKey({ home: 2, away: 2, penalty: null }),
    );
  });
});
