import { describe, expect, it } from 'vitest';
import { addDays, civilDate, dayRange, scheduleWindow, tzOffsetMs, zonedMidnight } from './time.js';

describe('fusos', () => {
  it('offset e dia civil no fuso', () => {
    const at = new Date('2026-10-22T00:30:00Z');
    expect(tzOffsetMs(at, 'America/Sao_Paulo')).toBe(-3 * 3600_000);
    expect(civilDate(at, 'America/Sao_Paulo')).toBe('2026-10-21');
    expect(civilDate(at, 'UTC')).toBe('2026-10-22');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('meia-noite e intervalo do dia, inclusive com horário de verão', () => {
    expect(zonedMidnight('2026-10-21', 'America/Sao_Paulo').toISOString()).toBe('2026-10-21T03:00:00.000Z');
    // Madri: 25/10/2026 tem 25 h (fim do horário de verão)
    const r = dayRange('2026-10-25', 'Europe/Madrid');
    expect(r.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('janela da agenda: date, from/to (dia ou instante) e padrão "a partir de hoje"', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    expect(scheduleWindow({ date: '2026-10-21' }, 'UTC', now)).toEqual({
      start: new Date('2026-10-21T00:00:00Z'),
      end: new Date('2026-10-22T00:00:00Z'),
    });
    expect(scheduleWindow({}, 'America/Sao_Paulo', now).start?.toISOString()).toBe(
      '2026-10-21T03:00:00.000Z',
    );
    expect(scheduleWindow({}, 'UTC', now, false)).toEqual({ start: null, end: null });
    const w = scheduleWindow({ from: '2026-10-01', to: '2026-10-31T12:00:00Z' }, 'UTC', now);
    expect(w.start?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.end?.toISOString()).toBe('2026-10-31T12:00:00.001Z');
    expect(scheduleWindow({ to: '2026-10-31' }, 'UTC', now)).toEqual({
      start: null,
      end: new Date('2026-11-01T00:00:00Z'),
    });
  });
});
