import { describe, expect, it } from 'vitest';
import {
  importance,
  isKnockoutStage,
  knockoutDecisive,
  PHASE_POINTS,
  roundProgress,
  type ImportanceInput,
} from './importance.js';
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
    // revisão de 2026-10: perna, prestígio e decisão estrutural do mata-mata
    [
      'volta da semifinal da Libertadores (eliminação + prestígio)',
      { tier: 1, stageKind: 'semi_final', leg: 2, decisive: ['elimination'], prestige: 10 },
      40 + 22 + 8 + 10,
    ],
    [
      'ida da semifinal da Libertadores: fase × 0,75 e nada decidido',
      { tier: 1, stageKind: 'semi_final', leg: 1, prestige: 10 },
      40 + 17 + 10,
    ],
    [
      'final em jogo único da Libertadores (título + prestígio)',
      { tier: 1, stageKind: 'final', decisive: ['title'], prestige: 10 },
      40 + 30 + 15 + 10,
    ],
    [
      'reta final do Brasileirão com título e rebaixamento em jogo (teto de 20)',
      { tier: 1, stageKind: 'regular', roundProgress: 31 / 37, decisive: ['title', 'relegation'] },
      40 + 9 + 20,
    ],
    ['prestígio acima do teto vira 10', { tier: 1, stageKind: 'group', prestige: 40 }, 40 + 6 + 10],
    ['prestígio negativo vira 0', { tier: 1, stageKind: 'group', prestige: -3 }, 40 + 6],
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
    ).toEqual({ tier: 40, phase: 22, derby: 24, decisive: 6, prestige: 0 });
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

describe('knockoutDecisive', () => {
  it('jogo único e volta eliminam; a final vale o título', () => {
    expect(knockoutDecisive('quarter_final', { legs: 1, leg: null })).toEqual(['elimination']);
    expect(knockoutDecisive('semi_final', { legs: 2, leg: 2 })).toEqual(['elimination']);
    expect(knockoutDecisive('final', { legs: 1, leg: null })).toEqual(['title']);
    expect(knockoutDecisive('final', { legs: 2, leg: 2 })).toEqual(['title']);
    expect(knockoutDecisive('relegation', { legs: 1, leg: null })).toEqual(['relegation']);
  });

  it('ida, perna desconhecida, 3º lugar e pontos corridos não decidem', () => {
    expect(knockoutDecisive('semi_final', { legs: 2, leg: 1 })).toEqual([]);
    expect(knockoutDecisive('final', { legs: 2, leg: null })).toEqual([]);
    expect(knockoutDecisive('third_place', { legs: 1, leg: null })).toEqual([]);
    expect(knockoutDecisive('regular', { legs: 1, leg: null })).toEqual([]);
    expect(knockoutDecisive(null, { legs: 1, leg: null })).toEqual([]);
  });
});

describe('isKnockoutStage', () => {
  it('rótulo com número de rodada é pontos corridos, mesmo com tipo de mata-mata', () => {
    expect(isKnockoutStage('semi_final', 'Semi-finals')).toBe(true);
    expect(isKnockoutStage('qualifying', '2nd Qualifying Round')).toBe(true);
    expect(isKnockoutStage('qualifying', 'Preliminary Round - 2')).toBe(false);
    expect(isKnockoutStage('relegation', 'Relegation - 5')).toBe(false);
    expect(isKnockoutStage('relegation', 'Relegation Play-offs')).toBe(true);
    expect(isKnockoutStage('knockout_round', '1st Round - 10')).toBe(false);
    expect(isKnockoutStage('regular', 'Regular Season - 32')).toBe(false);
    expect(isKnockoutStage('final', null)).toBe(true);
  });
});

describe('roundProgress', () => {
  it('rodada 1 → 0, última → 1', () => {
    expect(roundProgress(1, 38)).toBe(0);
    expect(roundProgress(38, 38)).toBe(1);
    expect(roundProgress(32, 38)).toBeCloseTo(31 / 37);
  });

  it('sem rodada ou total, ou rodada além do total', () => {
    expect(roundProgress(null, 38)).toBeNull();
    expect(roundProgress(5, null)).toBeNull();
    expect(roundProgress(5, 1)).toBeNull();
    expect(roundProgress(40, 38)).toBe(1);
  });
});
