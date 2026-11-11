import { describe, expect, it } from 'vitest';

import { endDayOf, endsAtOf, startDayOf, startsAtOf } from './sponsor-dates';

describe('vigência do patrocinador no fuso do cliente', () => {
  it('início é meia-noite local e fim é o dia seguinte, exclusivo', () => {
    expect(startsAtOf('2026-12-01', 'America/Sao_Paulo')).toBe('2026-12-01T03:00:00.000Z');
    expect(endsAtOf('2026-12-31', 'America/Sao_Paulo')).toBe('2027-01-01T03:00:00.000Z');
    expect(startsAtOf('2026-12-01', 'UTC')).toBe('2026-12-01T00:00:00.000Z');
    expect(startsAtOf('', 'UTC')).toBeNull();
  });

  it('dia em que a meia-noite não existe (Santiago, 06/09/2026) começa à 01:00 local', () => {
    expect(startsAtOf('2026-09-06', 'America/Santiago')).toBe('2026-09-06T04:00:00.000Z');
    expect(startDayOf(startsAtOf('2026-09-06', 'America/Santiago'), 'America/Santiago')).toBe('2026-09-06');
    expect(endDayOf(endsAtOf('2026-09-05', 'America/Santiago'), 'America/Santiago')).toBe('2026-09-05');
  });

  it('ida e volta mostram o mesmo dia digitado', () => {
    for (const tz of ['America/Sao_Paulo', 'America/New_York', 'Asia/Tokyo', 'UTC']) {
      expect(startDayOf(startsAtOf('2026-03-08', tz), tz)).toBe('2026-03-08');
      expect(endDayOf(endsAtOf('2026-11-01', tz), tz)).toBe('2026-11-01');
    }
  });

  it('fusos à frente de UTC e de meia hora: o dia começa na véspera em UTC', () => {
    expect(startsAtOf('2026-12-01', 'Asia/Tokyo')).toBe('2026-11-30T15:00:00.000Z');
    expect(endsAtOf('2026-12-31', 'Asia/Tokyo')).toBe('2026-12-31T15:00:00.000Z');
    expect(startsAtOf('2026-12-01', 'Asia/Kolkata')).toBe('2026-11-30T18:30:00.000Z');
    // Adelaide entra no horário de verão às 02:00 de 04/10/2026: a meia-noite ainda é +09:30
    expect(startsAtOf('2026-10-04', 'Australia/Adelaide')).toBe('2026-10-03T14:30:00.000Z');
  });

  it('virada de mês, ano bissexto, fim do horário de verão e campos vazios', () => {
    expect(endsAtOf('2028-02-28', 'UTC')).toBe('2028-02-29T00:00:00.000Z');
    expect(endsAtOf('2028-02-29', 'UTC')).toBe('2028-03-01T00:00:00.000Z');
    // Nova York sai do horário de verão às 02:00 de 01/11/2026: a meia-noite ainda é -04:00
    expect(startsAtOf('2026-11-01', 'America/New_York')).toBe('2026-11-01T04:00:00.000Z');
    expect(endsAtOf('', 'UTC')).toBeNull();
    expect(startDayOf(null, 'UTC')).toBe('');
    expect(endDayOf(null, 'UTC')).toBe('');
  });
});
