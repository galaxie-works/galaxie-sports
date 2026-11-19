import { describe, expect, it } from 'vitest';
import { RankingParams } from '@galaxie/contracts';
import { resolveRankingPeriod } from './routes.js';

describe('período do Ranking (#919)', () => {
  // 23h de 31/12 em São Paulo: ainda dezembro no programa, já janeiro em UTC
  const now = new Date('2027-01-01T02:00:00Z');

  it('o período corrente é o do fuso do programa', () => {
    expect(resolveRankingPeriod('current-month', 'America/Sao_Paulo', now)).toBe('2026-12');
    expect(resolveRankingPeriod('current-year', 'America/Sao_Paulo', now)).toBe('2026');
    expect(resolveRankingPeriod('current-month', 'UTC', now)).toBe('2027-01');
  });

  it('período explícito passa direto', () => {
    expect(resolveRankingPeriod('2026-11', 'America/Sao_Paulo', now)).toBe('2026-11');
    expect(resolveRankingPeriod('2026', 'UTC', now)).toBe('2026');
  });

  it('o contrato aceita os dois apelidos e recusa outros', () => {
    expect(RankingParams.safeParse({ period: 'current-month' }).success).toBe(true);
    expect(RankingParams.safeParse({ period: 'current-year' }).success).toBe(true);
    expect(RankingParams.safeParse({ period: 'current-week' }).success).toBe(false);
    expect(RankingParams.safeParse({ period: '2026-13' }).success).toBe(false);
  });
});
