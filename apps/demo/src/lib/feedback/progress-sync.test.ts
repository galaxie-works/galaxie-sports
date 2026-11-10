import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/db', () => ({ pool: {} }));
vi.mock('@/lib/notifications/store', () => ({}));
vi.mock('./settings-db', () => ({}));

const { progressDue } = await import('./progress-sync');

describe('progressDue', () => {
  const at = (iso: string) => new Date(iso);

  it('antes das 12h UTC não roda', () => {
    expect(progressDue(null, at('2026-11-09T11:59:00Z'))).toBe(false);
  });

  it('depois da hora, sem conferência de hoje, roda', () => {
    expect(progressDue(null, at('2026-11-09T12:00:00Z'))).toBe(true);
    const yesterday = { okAt: '2026-11-08T12:01:00Z', finishedAt: '2026-11-08T12:01:00Z', error: null };
    expect(progressDue(yesterday, at('2026-11-09T15:00:00Z'))).toBe(true);
  });

  it('já conferido hoje não roda de novo', () => {
    const today = { okAt: '2026-11-09T12:01:00Z', finishedAt: '2026-11-09T12:01:00Z', error: null };
    expect(progressDue(today, at('2026-11-09T23:00:00Z'))).toBe(false);
  });

  it('falhou há pouco: espera 2 horas para tentar de novo', () => {
    const failed = { okAt: '2026-11-08T12:01:00Z', finishedAt: '2026-11-09T12:01:00Z', error: 'x' };
    expect(progressDue(failed, at('2026-11-09T13:00:00Z'))).toBe(false);
    expect(progressDue(failed, at('2026-11-09T14:02:00Z'))).toBe(true);
  });
});
