import { loadCatalog } from '@galaxie/billing';
import { describe, expect, it } from 'vitest';

import { normalizeUsage, recommendCapacityTier } from './capacity';

const { tiers } = loadCatalog().capacity;

describe('calculadora de capacidade (PL7)', () => {
  it.each([
    // [visualizações/mês, pico, escrevendo no chat] → faixa, autoatendimento
    [0, 0, 0, 'C1', true],
    [1_000_000, 5_000, 1_000, 'C1', true],
    [1_000_001, 0, 0, 'C2', true],
    [0, 5_001, 0, 'C2', true],
    [0, 0, 1_001, 'C2', true],
    [10_000_000, 50_000, 10_000, 'C2', true],
    [10_000_001, 0, 0, 'C3', false],
    [0, 50_001, 0, 'C3', false],
    [50_000_000, 250_000, 50_000, 'C3', false],
    [50_000_001, 0, 0, 'C4', false],
    [0, 0, 50_001, 'C4', false],
    [1_000_000_000, 1_000_000, 1_000_000, 'C4', false],
  ] as const)(
    '%s views, %s no pico, %s no chat → %s (autoatendimento %s)',
    (views, peak, chat, tier, self) => {
      expect(
        recommendCapacityTier(tiers, { viewsPerMonth: views, peakConcurrent: peak, chatWriters: chat }),
      ).toEqual({ tier, selfService: self });
    },
  );

  it('a menor faixa que cobre as três medidas manda: uma só acima já sobe de faixa', () => {
    expect(
      recommendCapacityTier(tiers, { viewsPerMonth: 10, peakConcurrent: 10, chatWriters: 2_000 }).tier,
    ).toBe('C2');
  });

  it('normaliza o que a pessoa digita: separadores de milhar, vazio e negativo', () => {
    expect(normalizeUsage('1.000.000')).toBe(1_000_000);
    expect(normalizeUsage('50 000')).toBe(50_000);
    expect(normalizeUsage('')).toBe(0);
    expect(normalizeUsage(-5)).toBe(0);
    expect(normalizeUsage('abc')).toBe(0);
    expect(normalizeUsage(12.7)).toBe(12);
  });
});
