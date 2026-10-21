/** Utilidades de fuso IANA para os filtros por dia civil (`?date=`, `?from=`, `?to=` com `?tz=`). */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallClock(at: Date, tz: string) {
  const p = Object.fromEntries(
    formatter(tz)
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset do fuso no instante (ms a somar ao UTC para obter a hora local). */
export function tzOffsetMs(at: Date, tz: string): number {
  const w = wallClock(at, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Dia civil (AAAA-MM-DD) de um instante no fuso. */
export function civilDate(at: Date, tz: string): string {
  const w = wallClock(at, tz);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Soma dias a uma data civil AAAA-MM-DD. */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`data inválida: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Instante da meia-noite do dia civil no fuso (considera horário de verão). */
export function zonedMidnight(date: string, tz: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`data inválida: ${date}`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Intervalo [início, fim) do dia civil no fuso. */
export function dayRange(date: string, tz: string): { start: Date; end: Date } {
  return { start: zonedMidnight(date, tz), end: zonedMidnight(addDays(date, 1), tz) };
}

export function isCivilDate(value: string): boolean {
  return DATE_RE.test(value);
}

/**
 * Janela de busca da agenda: `date` (dia no fuso) tem precedência; `from`/`to` aceitam dia civil
 * (início/fim inclusivo do dia no fuso) ou instante ISO 8601. Sem nada, começa hoje (no fuso).
 */
export function scheduleWindow(
  input: { date?: string | undefined; from?: string | undefined; to?: string | undefined },
  tz: string,
  now: Date,
  defaultFromToday = true,
): { start: Date | null; end: Date | null } {
  if (input.date) {
    const r = dayRange(input.date, tz);
    return { start: r.start, end: r.end };
  }
  const start = input.from
    ? isCivilDate(input.from)
      ? zonedMidnight(input.from, tz)
      : new Date(input.from)
    : defaultFromToday && !input.to
      ? zonedMidnight(civilDate(now, tz), tz)
      : null;
  const end = input.to
    ? isCivilDate(input.to)
      ? zonedMidnight(addDays(input.to, 1), tz)
      : new Date(Date.parse(input.to) + 1)
    : null;
  return { start, end };
}
