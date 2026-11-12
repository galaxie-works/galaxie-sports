import { describe, expect, it } from 'vitest';
import { diffStandings, type StandingSnapshotRow } from './simulate.js';

const row = (
  group: string,
  participantId: string,
  rank: number,
  source = 'computed',
  points = 0,
): StandingSnapshotRow => ({ group, participantId, rank, points, source });

describe('diffStandings (prévia do #880)', () => {
  it('conta posições mudadas, maior salto e linhas do fornecedor trocadas', () => {
    const before = [row('', 'a', 1, 'provider'), row('', 'b', 2, 'provider'), row('', 'c', 3, 'provider')];
    const after = [row('', 'a', 3), row('', 'b', 1), row('', 'c', 2)];
    expect(diffStandings(before, after)).toEqual({
      moved: 3,
      maxShift: 2,
      providerReplaced: 3,
      added: 0,
      removed: 0,
    });
  });

  it('linha nova e linha que sai contam à parte; mesma posição não conta', () => {
    const before = [row('A', 'a', 1), row('A', 'x', 2)];
    const after = [row('A', 'a', 1), row('B', 'y', 1)];
    expect(diffStandings(before, after)).toEqual({
      moved: 0,
      maxShift: 0,
      providerReplaced: 0,
      added: 1,
      removed: 1,
    });
  });

  it('o mesmo time em grupos diferentes é chave diferente', () => {
    const before = [row('A', 't', 1, 'provider')];
    const after = [row('A', 't', 1), row('Anual', 't', 4)];
    expect(diffStandings(before, after)).toMatchObject({ providerReplaced: 1, added: 1, moved: 0 });
  });
});
