import { describe, expect, it } from 'vitest';
import { aflPercentage, goalsBehinds } from './afl';

describe('AFL', () => {
  it('placar em gols.behinds', () => {
    expect(goalsBehinds({ goals: 12, behinds: 14 })).toBe('12.14');
    expect(goalsBehinds({ goals: 0, behinds: 3 })).toBe('0.3');
    expect(goalsBehinds({ goals: null, behinds: 3 })).toBeNull();
    expect(goalsBehinds(undefined)).toBeNull();
  });

  it('porcentagem da tabela: pontos pró ÷ contra × 100, com uma casa', () => {
    // Sydney Swans 2024: 2242 pró, 1769 contra
    expect(aflPercentage(2242, 1769)).toBe(126.7);
    expect(aflPercentage(1500, 1500)).toBe(100);
    expect(aflPercentage(10, 0)).toBeNull();
  });
});
