import { describe, expect, it } from 'vitest';
import { rugbyBonusPoints } from './rugby-standings';

describe('rugbyBonusPoints', () => {
  it('Rugby Championship 2024: total menos 4 por vitória e 2 por empate', () => {
    const rows = [
      { points: 24, played: 6, won: 5, drawn: 0 }, // África do Sul
      { points: 16, played: 6, won: 3, drawn: 0 }, // Nova Zelândia
      { points: 14, played: 6, won: 3, drawn: 0 }, // Argentina
      { points: 5, played: 6, won: 1, drawn: 0 }, // Austrália
    ];
    expect(rugbyBonusPoints(rows)).toEqual([4, 4, 2, 1]);
  });

  it('rúgbi de 7 (3/2/1 por jogo) não fecha a conta e fica sem a coluna', () => {
    const pool = [
      { points: 9, played: 3, won: 3, drawn: 0 },
      { points: 5, played: 3, won: 1, drawn: 0 },
    ];
    expect(rugbyBonusPoints(pool)).toBeNull();
  });

  it('bônus acima de 2 por jogo também invalida', () => {
    expect(rugbyBonusPoints([{ points: 10, played: 1, won: 1, drawn: 0 }])).toBeNull();
    expect(rugbyBonusPoints([])).toBeNull();
  });
});
