/**
 * Momentum temporal (docs/04 §3.2 e docs/06 §4): calculado na leitura, no fuso do cliente — nunca
 * armazenado, porque muda com o relógio e com o fuso de quem pergunta.
 */
import { isInPlay, type EventStatus } from './status.js';

export const MOMENTUMS = ['D-3+', 'D-2', 'D-1', 'today', 'T-60', 'T-30', 'T-10', 'starting', 'live'] as const;
export type Momentum = (typeof MOMENTUMS)[number];

export interface MomentumInput {
  status: EventStatus;
  startsAt: Date;
}

/** `true` se o fuso IANA é reconhecido pelo runtime (ex.: "America/Sao_Paulo"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Dia civil (meia-noite UTC do mesmo Y-M-D) de um instante no fuso pedido. */
function civilDay(at: Date, timeZone: string): number {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

/** Diferença em dias civis entre `startsAt` e `now`, no fuso do cliente. */
export function calendarDaysUntil(startsAt: Date, now: Date, timeZone: string): number {
  return Math.round((civilDay(startsAt, timeZone) - civilDay(now, timeZone)) / 86_400_000);
}

/**
 * Momentum de um evento no instante `now`, no fuso `timeZone` do cliente.
 *
 * - `live`: em andamento (inclui intervalo e interrupção);
 * - `starting`: horário oficial já passou e o fornecedor ainda não confirmou o início;
 * - `T-10` (0–10 min), `T-30` (10–30 min), `T-60` (30–60 min): minutos para o início;
 * - `today`: mais de 60 min para o início, no mesmo dia civil do cliente;
 * - `D-1`, `D-2`, `D-3+`: dias civis até o início.
 *
 * Eventos encerrados, adiados, cancelados ou abandonados não têm momentum (`null`).
 * Fuso inválido cai em UTC.
 */
export function momentum(event: MomentumInput, now: Date, timeZone = 'UTC'): Momentum | null {
  if (isInPlay(event.status)) return 'live';
  if (event.status !== 'scheduled' && event.status !== 'starting') return null;

  const minutes = (event.startsAt.getTime() - now.getTime()) / 60_000;
  if (minutes <= 0) return 'starting';
  if (minutes <= 10) return 'T-10';
  if (minutes <= 30) return 'T-30';
  if (minutes <= 60) return 'T-60';

  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const days = calendarDaysUntil(event.startsAt, now, tz);
  if (days <= 0) return 'today';
  if (days === 1) return 'D-1';
  if (days === 2) return 'D-2';
  return 'D-3+';
}
