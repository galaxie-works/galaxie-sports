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
});
