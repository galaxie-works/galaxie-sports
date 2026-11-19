import { describe, expect, it } from 'vitest';
import { recentSince, recentSinceDay, recentSinceYear } from './recent-since.js';

describe('recentSince', () => {
  it('em 2026 mantém 2026-01-01', () => {
    expect(recentSinceDay(new Date('2026-11-19T12:00:00Z'))).toBe('2026-01-01');
  });

  it('em 2027 continua no começo da base', () => {
    expect(recentSinceYear(new Date('2027-01-01T00:00:00Z'))).toBe(2026);
  });

  it('a partir de 2028 anda com o calendário', () => {
    expect(recentSinceDay(new Date('2028-03-10T00:00:00Z'))).toBe('2027-01-01');
    expect(recentSince(new Date('2031-12-31T23:59:59Z')).toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });
});
