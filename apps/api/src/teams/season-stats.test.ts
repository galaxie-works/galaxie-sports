import { describe, expect, it } from 'vitest';
import { readTeamSeasonStats } from './season-stats.js';

describe('readTeamSeasonStats (#893)', () => {
  it('linha sem blocos (gravada antes de um bloco existir) sai vazia, sem quebrar', () => {
    const s = readTeamSeasonStats({});
    expect(s.record.played).toEqual({ home: null, away: null, total: null });
    expect(s.formations).toEqual([]);
    expect(s.cards).toEqual({ yellow: null, red: null, yellow_by_minute: [], red_by_minute: [] });
    expect(s.biggest.win).toEqual({ home: null, away: null });
    expect(readTeamSeasonStats(null).goals.scored_lines).toEqual([]);
  });

  it('descarta itens malformados e soma os cartões das faixas', () => {
    const s = readTeamSeasonStats({
      formations: [{ formation: '4-4-2', played: 3 }, { formation: '', played: 1 }, { played: 2 }],
      goals: { scored_lines: [{ line: 2.5, over: 4, under: 6 }, { line: 'x' }] },
      cards: {
        yellow_by_minute: [{ from: 0, to: 15, count: 2 }, { from: 16, to: 30, count: 3 }, { count: 'x' }],
      },
      biggest: { win: { home: { for: 3, against: 0 }, away: { for: 1 } } },
    });
    expect(s.formations).toEqual([{ formation: '4-4-2', played: 3 }]);
    expect(s.goals.scored_lines).toEqual([{ line: 2.5, over: 4, under: 6 }]);
    expect(s.cards).toMatchObject({ yellow: 5, red: 0 });
    expect(s.biggest.win).toEqual({ home: { for: 3, against: 0 }, away: null });
  });
});
