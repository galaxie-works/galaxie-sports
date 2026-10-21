import { describe, expect, it } from 'vitest';
import { assessMedalQuality, checkEventMedals } from './report.js';

describe('checkEventMedals', () => {
  it('aceita prova completa e luta com dois bronzes', () => {
    expect(checkEventMedals({ gold: 1, silver: 1, bronze: 1, twoBronzes: false })).toEqual([]);
    expect(checkEventMedals({ gold: 1, silver: 1, bronze: 2, twoBronzes: true })).toEqual([]);
  });

  it('aponta cobertura parcial, empates e bronze faltando em luta', () => {
    expect(checkEventMedals({ gold: 0, silver: 1, bronze: 1, twoBronzes: false })).toEqual(['no_gold']);
    expect(checkEventMedals({ gold: 2, silver: 0, bronze: 1, twoBronzes: false })).toEqual([
      'no_silver',
      'multiple_gold',
    ]);
    expect(checkEventMedals({ gold: 1, silver: 1, bronze: 1, twoBronzes: true })).toEqual(['bronze_count']);
    expect(checkEventMedals({ gold: 1, silver: 1, bronze: 2, twoBronzes: false })).toEqual(['bronze_count']);
  });
});

describe('assessMedalQuality', () => {
  it('usa o total da edição quando conhecido', () => {
    expect(assessMedalQuality({ type: 'OG', derivedTotal: 972, editionTotal: 972, byNoc: [] })).toEqual({
      coverage: 1,
      quality: 'complete',
    });
    expect(assessMedalQuality({ type: 'OG', derivedTotal: 930, editionTotal: 972, byNoc: [] }).quality).toBe(
      'partial',
    );
  });

  it('estima pela soma dos CONs com referência', () => {
    const byNoc = [
      { derived: 10, reference: 10 },
      { derived: 4, reference: 5 },
      { derived: 3, reference: 3 },
      { derived: 2, reference: 2 },
      { derived: 7, reference: 6 },
    ];
    const q = assessMedalQuality({ type: 'OG', derivedTotal: 26, editionTotal: null, byNoc });
    expect(q.coverage).toBeCloseTo(25 / 26);
    expect(q.quality).toBe('partial');
  });

  it('Pan sem referência e com poucas medalhas é insuficiente; sem como medir, desconhecido', () => {
    expect(assessMedalQuality({ type: 'PAN', derivedTotal: 73, editionTotal: null, byNoc: [] })).toEqual({
      coverage: null,
      quality: 'insufficient',
    });
    expect(assessMedalQuality({ type: 'OG', derivedTotal: 73, editionTotal: null, byNoc: [] }).quality).toBe(
      'unknown',
    );
  });
});
