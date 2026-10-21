import { describe, expect, it } from 'vitest';
import { importance, PHASE_POINTS, type ImportanceInput } from './importance.js';
import { STAGE_KINDS } from '../model.js';

describe('importance (tabela de casos)', () => {
  const cases: [string, ImportanceInput, number][] = [
    ['tier desconhecido, fase desconhecida', { tier: null, stageKind: null }, 5 + 3],
    ['rodada comum da Série A (tier 1)', { tier: 1, stageKind: 'regular' }, 40 + 4],
    ['última rodada da Série A', { tier: 1, stageKind: 'regular', roundProgress: 1 }, 40 + 4 + 6],
    ['meio do campeonato', { tier: 1, stageKind: 'regular', roundProgress: 0.5 }, 40 + 4 + 3],
    ['liga tier 3', { tier: 3, stageKind: 'regular' }, 10 + 4],
    ['tier fora da tabela', { tier: 7, stageKind: 'regular' }, 5 + 4],
    ['oitavas de copa tier 2', { tier: 2, stageKind: 'round_of_16' }, 25 + 12],
    ['final continental', { tier: 1, stageKind: 'final' }, 40 + 30],
    [
      'clássico intensidade 5 na Série A',
      { tier: 1, stageKind: 'regular', derby: { derbyId: 'd', intensity: 5 } },
      40 + 4 + 30,
    ],
    [
      'clássico intensidade 3 em estadual',
      { tier: 2, stageKind: 'regular', derby: { derbyId: 'd', intensity: 3 } },
      25 + 4 + 18,
    ],
    ['jogo do título', { tier: 1, stageKind: 'regular', decisive: ['title'] }, 40 + 4 + 15],
    [
      'decisões somam até o teto de 20',
      { tier: 1, stageKind: 'regular', decisive: ['title', 'relegation'] },
      40 + 4 + 20,
    ],
    [
      'flags repetidas contam uma vez',
      { tier: 2, stageKind: 'group', decisive: ['elimination', 'elimination'] },
      25 + 6 + 8,
    ],
    [
      'final clássica decisiva bate o teto de 100',
      { tier: 1, stageKind: 'final', derby: { derbyId: 'd', intensity: 5 }, decisive: ['title'] },
      100,
    ],
    ['amistoso', { tier: 3, stageKind: 'friendly' }, 10],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(importance(input).score).toBe(expected);
  });

  it('expõe o detalhamento por componente', () => {
    expect(
      importance({
        tier: 1,
        stageKind: 'semi_final',
        derby: { derbyId: 'd', intensity: 4 },
        decisive: ['qualification'],
      }).breakdown,
    ).toEqual({ tier: 40, phase: 22, derby: 24, decisive: 6 });
  });

  it('intensidade fora de 1–5 é limitada', () => {
    expect(
      importance({ tier: null, stageKind: null, derby: { derbyId: 'd', intensity: 9 } }).breakdown.derby,
    ).toBe(30);
  });

  it('toda fase canônica tem peso', () => {
    for (const kind of STAGE_KINDS) expect(PHASE_POINTS[kind]).toBeTypeOf('number');
  });
});
