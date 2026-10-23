import { describe, expect, it } from 'vitest';
import { hockeySplit } from './hockey-standings';

describe('hockeySplit', () => {
  it('NHL 2024/25: separa o tempo normal da prorrogação', () => {
    const rows = [
      { won: 56, lost: 26, ot_won: 13, ot_lost: 4 }, // Winnipeg Jets, 116 pts
      { won: 50, lost: 32, ot_won: 6, ot_lost: 7 },
    ];
    expect(hockeySplit(rows)).toEqual([
      { won: 43, otWon: 13, otLost: 4, lost: 22 },
      { won: 44, otWon: 6, otLost: 7, lost: 25 },
    ]);
  });

  it('uma linha sem a separação deixa a tabela com os totais', () => {
    expect(
      hockeySplit([
        { won: 10, lost: 2, ot_won: 1, ot_lost: 0 },
        { won: 8, lost: 4, ot_won: null, ot_lost: null },
      ]),
    ).toBeNull();
    expect(hockeySplit([])).toBeNull();
  });

  it('prorrogação maior que o total é dado inconsistente', () => {
    expect(hockeySplit([{ won: 2, lost: 0, ot_won: 3, ot_lost: 0 }])).toBeNull();
  });
});
