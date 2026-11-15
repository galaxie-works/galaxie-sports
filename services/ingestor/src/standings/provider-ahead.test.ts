import { describe, expect, it } from 'vitest';
import { providerAhead } from './recompute.js';

// trava do #880: com menos jogos que a linha do fornecedor no mesmo grupo, fica a tabela do fornecedor
describe('providerAhead', () => {
  const table = (group: string, rows: [string, number][]) => ({
    group,
    rows: rows.map(([teamId, played]) => ({ teamId, played })),
  });

  it('grupo em que algum time tem mais jogos no fornecedor fica de fora', () => {
    const provider = [
      { group: 'Liga', participantId: 'a', played: 22 },
      { group: 'Liga', participantId: 'b', played: 21 },
    ];
    expect(
      providerAhead(provider, [
        table('Liga', [
          ['a', 22],
          ['b', 20],
        ]),
      ]),
    ).toEqual(['Liga']);
  });

  it('mesmos jogos ou mais jogos na nossa: grava a nossa', () => {
    const provider = [{ group: 'Liga', participantId: 'a', played: 10 }];
    expect(providerAhead(provider, [table('Liga', [['a', 10]])])).toEqual([]);
    expect(providerAhead(provider, [table('Liga', [['a', 11]])])).toEqual([]);
  });

  it('time do fornecedor que não aparece na nossa conta como zero jogos', () => {
    const provider = [{ group: 'Liga', participantId: 'x', played: 3 }];
    expect(providerAhead(provider, [table('Liga', [['a', 3]])])).toEqual(['Liga']);
  });

  it('só compara o mesmo grupo; jogos nulos do fornecedor contam como zero', () => {
    const provider = [
      { group: 'Promedios', participantId: 'a', played: 90 },
      { group: 'Liga', participantId: 'a', played: null },
    ];
    expect(providerAhead(provider, [table('Liga', [['a', 5]])])).toEqual([]);
  });
});
