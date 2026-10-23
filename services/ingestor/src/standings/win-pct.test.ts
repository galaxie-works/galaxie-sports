import { describe, expect, it } from 'vitest';
import { regularSeasonCutoff, winPct, winPctTables } from './win-pct.js';

const game = (homeId: string, awayId: string, homeGoals: number, awayGoals: number, day: number) => ({
  homeId,
  awayId,
  homeGoals,
  awayGoals,
  playedAt: `2024-10-${String(day).padStart(2, '0')}T00:00:00Z`,
});

describe('winPctTables', () => {
  it('ordena por aproveitamento, não por vitórias, com pontos = vitórias', () => {
    // A: 2-0 em 2 jogos (1.000); B: 2-2 em 4 (.500); C: 1-3 em 4 (.250)
    const [table] = winPctTables([
      game('A', 'B', 5, 2, 1),
      game('B', 'C', 3, 1, 2),
      game('C', 'B', 4, 0, 3),
      game('A', 'C', 7, 6, 4),
      game('B', 'C', 2, 1, 5),
      game('C', 'B', 0, 9, 6),
    ]);
    expect(table!.group).toBe('');
    expect(table!.rows.map((r) => [r.teamId, r.rank, r.won, r.lost, r.points])).toEqual([
      ['A', 1, 2, 0, 2],
      ['B', 2, 3, 2, 3],
      ['C', 3, 1, 4, 1],
    ]);
    const b = table!.rows[1]!;
    expect([b.goalsFor, b.goalsAgainst, b.goalDifference]).toEqual([16, 11, 5]);
    expect(b.form).toEqual(['L', 'W', 'L', 'W', 'W']);
  });

  it('desempata pct igual por vitórias e depois saldo de corridas', () => {
    const [table] = winPctTables([
      game('A', 'B', 1, 0, 1),
      game('B', 'A', 10, 0, 2),
      game('C', 'D', 3, 2, 3),
      game('D', 'C', 2, 1, 4),
    ]);
    expect(table!.rows.map((r) => r.teamId)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('pct ignora empates', () => {
    expect(winPct(3, 1)).toBe(0.75);
    expect(winPct(0, 0)).toBe(0);
  });
});

describe('regularSeasonCutoff', () => {
  const g = (homeId: string, awayId: string, date: string) => ({
    homeId,
    awayId,
    homeGoals: 1,
    awayGoals: 0,
    playedAt: `${date}T01:00:00.000Z`,
  });
  // fase regular de 4 times até 28/12; round robin dos 2 primeiros a partir de 02/01
  const regular = [
    ...['2024-12-10', '2024-12-15', '2024-12-20'].flatMap((d) => [g('A', 'B', d), g('C', 'D', d)]),
    g('A', 'C', '2024-12-28'),
    g('B', 'D', '2024-12-28'),
  ];

  it('corta no último jogo dos eliminados', () => {
    const cutoff = regularSeasonCutoff([...regular, g('A', 'B', '2025-01-02'), g('B', 'A', '2025-01-05')]);
    expect(cutoff).toBe('2024-12-28T19:00:00.000Z');
  });

  it('sem corte quando todos terminam juntos', () => {
    expect(regularSeasonCutoff(regular)).toBeNull();
  });

  it('time que desistiu cedo não vira corte', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      g('A', 'B', `2024-11-${String(10 + i).padStart(2, '0')}`),
    );
    expect(regularSeasonCutoff([g('C', 'A', '2024-11-01'), ...many])).toBeNull();
  });
});
