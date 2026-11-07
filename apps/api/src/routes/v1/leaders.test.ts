import { describe, expect, it } from 'vitest';
import { leaderValue, rankLeaders, type LeaderTotals } from './leaders.js';

const row = (personId: string, o: Partial<LeaderTotals> = {}): LeaderTotals => ({
  personId,
  appearances: 10,
  minutes: 900,
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
  ...o,
});

describe('rankLeaders', () => {
  it('ordena pelo valor e empatados dividem a posição (1, 2, 2, 4)', () => {
    const r = rankLeaders(
      [row('a', { goals: 5 }), row('b', { goals: 9 }), row('c', { goals: 5 }), row('d', { goals: 3 })],
      'goals',
      10,
    );
    expect(r.map((x) => [x.personId, x.rank, x.value])).toEqual([
      ['b', 1, 9],
      ['a', 2, 5],
      ['c', 2, 5],
      ['d', 4, 3],
    ]);
  });

  it('no empate, quem jogou menos vem antes; depois menos minutos', () => {
    const r = rankLeaders(
      [
        row('a', { goals: 5, appearances: 12 }),
        row('b', { goals: 5, appearances: 8, minutes: 700 }),
        row('c', { goals: 5, appearances: 8, minutes: 600 }),
      ],
      'goals',
      10,
    );
    expect(r.map((x) => x.personId)).toEqual(['c', 'b', 'a']);
    expect(r.every((x) => x.rank === 1)).toBe(true);
  });

  it('cartões somam amarelos e vermelhos e os vermelhos desempatam', () => {
    const a = row('a', { yellowCards: 6, redCards: 0 });
    const b = row('b', { yellowCards: 4, redCards: 2 });
    expect(leaderValue(a, 'cards')).toBe(6);
    const r = rankLeaders([a, b], 'cards', 10);
    expect(r.map((x) => x.personId)).toEqual(['b', 'a']);
    expect(r.map((x) => x.rank)).toEqual([1, 1]);
  });

  it('assistências, sem quem tem zero e com o corte do limite', () => {
    const r = rankLeaders(
      [
        row('a', { assists: 2 }),
        row('b', { assists: 0, goals: 10 }),
        row('c', { assists: 7 }),
        row('d', { assists: 1 }),
      ],
      'assists',
      2,
    );
    expect(r.map((x) => x.personId)).toEqual(['c', 'a']);
  });
});
