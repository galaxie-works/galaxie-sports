import { describe, expect, it } from 'vitest';
import { calendarDaysUntil, isValidTimeZone, momentum, type Momentum } from './momentum.js';
import type { EventStatus } from './status.js';

// Jogo às 22:00 UTC de 21/10 = 19:00 em São Paulo (UTC-3) e 22/10 00:00 em Madri (UTC+2).
const KICKOFF = new Date('2026-10-21T22:00:00Z');
const minutesBefore = (m: number) => new Date(KICKOFF.getTime() - m * 60_000);

describe('momentum (tabela de casos)', () => {
  const cases: [string, EventStatus, Date, string, Momentum | null][] = [
    ['ao vivo', 'live', minutesBefore(-30), 'America/Sao_Paulo', 'live'],
    ['intervalo conta como ao vivo', 'break', minutesBefore(-50), 'America/Sao_Paulo', 'live'],
    ['interrompido conta como ao vivo', 'suspended', minutesBefore(-60), 'America/Sao_Paulo', 'live'],
    ['encerrado não tem momentum', 'finished', minutesBefore(-120), 'America/Sao_Paulo', null],
    ['adiado não tem momentum', 'postponed', minutesBefore(60), 'America/Sao_Paulo', null],
    ['cancelado não tem momentum', 'cancelled', minutesBefore(60), 'America/Sao_Paulo', null],
    ['apito passou sem confirmação', 'starting', minutesBefore(-2), 'America/Sao_Paulo', 'starting'],
    ['scheduled atrasado também é starting', 'scheduled', minutesBefore(-1), 'UTC', 'starting'],
    ['exatamente no apito', 'starting', minutesBefore(0), 'UTC', 'starting'],
    ['T-10 (limite)', 'starting', minutesBefore(10), 'UTC', 'T-10'],
    ['T-10', 'starting', minutesBefore(5), 'UTC', 'T-10'],
    ['T-30', 'scheduled', minutesBefore(25), 'UTC', 'T-30'],
    ['T-30 (limite)', 'scheduled', minutesBefore(30), 'UTC', 'T-30'],
    ['T-60', 'scheduled', minutesBefore(45), 'UTC', 'T-60'],
    ['T-60 (limite)', 'scheduled', minutesBefore(60), 'UTC', 'T-60'],
    [
      'hoje (São Paulo, 12:00 local)',
      'scheduled',
      new Date('2026-10-21T15:00:00Z'),
      'America/Sao_Paulo',
      'today',
    ],
    [
      'hoje (São Paulo, 00:30 local)',
      'scheduled',
      new Date('2026-10-21T03:30:00Z'),
      'America/Sao_Paulo',
      'today',
    ],
    // 20/10 23:30 em São Paulo → o jogo é amanhã no fuso do cliente, mas já é "hoje" em UTC
    ['véspera no fuso do cliente', 'scheduled', new Date('2026-10-21T02:30:00Z'), 'America/Sao_Paulo', 'D-1'],
    ['mesmo instante em UTC é hoje', 'scheduled', new Date('2026-10-21T02:30:00Z'), 'UTC', 'today'],
    // em Madri o jogo é 22/10 00:00; às 21/10 12:00 locais é véspera
    ['Madri: virada de dia', 'scheduled', new Date('2026-10-21T10:00:00Z'), 'Europe/Madrid', 'D-1'],
    ['D-2', 'scheduled', new Date('2026-10-19T15:00:00Z'), 'America/Sao_Paulo', 'D-2'],
    ['D-3+', 'scheduled', new Date('2026-10-18T15:00:00Z'), 'America/Sao_Paulo', 'D-3+'],
    ['D-3+ (uma semana)', 'scheduled', new Date('2026-10-14T15:00:00Z'), 'America/Sao_Paulo', 'D-3+'],
    ['fuso inválido cai em UTC', 'scheduled', new Date('2026-10-21T02:30:00Z'), 'Lua/Base_Alfa', 'today'],
  ];

  it.each(cases)('%s', (_name, status, now, tz, expected) => {
    expect(momentum({ status, startsAt: KICKOFF }, now, tz)).toBe(expected);
  });
});

describe('utilidades de fuso', () => {
  it('valida fusos IANA', () => {
    expect(isValidTimeZone('America/Mexico_City')).toBe(true);
    expect(isValidTimeZone('Nada/Aqui')).toBe(false);
  });

  it('conta dias civis no fuso pedido', () => {
    const now = new Date('2026-10-21T02:30:00Z');
    expect(calendarDaysUntil(KICKOFF, now, 'America/Sao_Paulo')).toBe(1);
    expect(calendarDaysUntil(KICKOFF, now, 'UTC')).toBe(0);
  });
});
