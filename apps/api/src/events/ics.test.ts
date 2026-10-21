import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine, icsDate, icsEscape } from './ics.js';

describe('iCalendar (RFC 5545)', () => {
  it('formata instantes em UTC e escapa texto', () => {
    expect(icsDate(new Date('2026-10-22T00:30:00.123Z'))).toBe('20261022T003000Z');
    expect(icsEscape('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
  });

  it('dobra linhas longas em 75 octetos sem quebrar caracteres multibyte', () => {
    const line = `SUMMARY:${'Clássico × '.repeat(12)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('gera um VCALENDAR válido com CRLF', () => {
    const ics = buildIcs(
      [
        {
          uid: 'abc@galaxie.sports',
          start: new Date('2026-10-22T00:30:00Z'),
          end: new Date('2026-10-22T02:25:00Z'),
          summary: 'Palmeiras × Fluminense',
          description: 'Libertadores · Semifinal',
          location: 'Allianz Parque, São Paulo',
          status: 'CONFIRMED',
          updatedAt: new Date('2026-10-21T12:00:00Z'),
          categories: ['football'],
        },
      ],
      { now: new Date('2026-10-21T12:00:00Z') },
    );
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Galaxie Sports//API v1//PT',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:abc@galaxie.sports',
        'DTSTAMP:20261021T120000Z',
        'DTSTART:20261022T003000Z',
        'DTEND:20261022T022500Z',
        'SUMMARY:Palmeiras × Fluminense',
        'DESCRIPTION:Libertadores · Semifinal',
        'LOCATION:Allianz Parque\\, São Paulo',
        'CATEGORIES:football',
        'STATUS:CONFIRMED',
        'LAST-MODIFIED:20261021T120000Z',
        'SEQUENCE:92584000',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });
});
