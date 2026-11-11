/**
 * Período do extrato da Cosmos: o valor do seletor de datas (ReUI c-date-selector-2) vira `from`/`to` da URL
 * (AAAA-MM-DD, `to` inclusive) e volta. Puro, para o teste.
 */
import type { DateSelectorValue } from '@/components/reui/date-selector';

/** Antes da Cosmos não há extrato: "antes de" começa aqui. */
const EARLIEST = '2026-01-01';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const dayOf = (d: Date) => ymd(d.getFullYear(), d.getMonth(), d.getDate());
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Primeiro e último mês (0–11) de cada unidade do seletor. */
function span(period: DateSelectorValue['period'], year: number, value: number): [string, string] {
  switch (period) {
    case 'month':
      return [ymd(year, value, 1), ymd(year, value, lastDay(year, value))];
    case 'quarter':
      return [ymd(year, value * 3, 1), ymd(year, value * 3 + 2, lastDay(year, value * 3 + 2))];
    case 'half-year':
      return [ymd(year, value * 6, 1), ymd(year, value * 6 + 5, lastDay(year, value * 6 + 5))];
    default:
      return [ymd(year, 0, 1), ymd(year, 11, 31)];
  }
}

/** Valor do seletor → `{ from, to }` (inclusive); null quando o valor ainda está incompleto. */
export function periodFromSelector(
  v: DateSelectorValue | undefined,
  today: Date = new Date(),
): { from: string; to: string } | null {
  if (!v) return null;
  const now = dayOf(today);
  if (v.period === 'day') {
    if (!v.startDate) return null;
    const start = dayOf(v.startDate);
    if (v.operator === 'before') return { from: EARLIEST, to: dayOf(addDays(v.startDate, -1)) };
    if (v.operator === 'after') return { from: dayOf(addDays(v.startDate, 1)), to: now };
    return { from: start, to: v.endDate ? dayOf(v.endDate) : start };
  }
  const single =
    v.period === 'year'
      ? v.year
      : v.period === 'month'
        ? v.month
        : v.period === 'quarter'
          ? v.quarter
          : v.halfYear;
  if (v.rangeStart && v.rangeEnd) {
    const [from] = span(v.period, v.rangeStart.year, v.rangeStart.value);
    const [, to] = span(v.period, v.rangeEnd.year, v.rangeEnd.value);
    return { from, to };
  }
  if (v.year === undefined || single === undefined) return null;
  const [from, to] = span(v.period, v.year, v.period === 'year' ? 0 : single);
  if (v.operator === 'before')
    return { from: EARLIEST, to: dayOf(addDays(new Date(`${from}T00:00:00`), -1)) };
  if (v.operator === 'after') return { from: dayOf(addDays(new Date(`${to}T00:00:00`), 1)), to: now };
  return { from, to };
}

/** `{ from, to }` da URL → valor do seletor (intervalo de dias), para abrir com o período atual. */
export function selectorFromPeriod(period: { from: string; to: string }): DateSelectorValue {
  return {
    period: 'day',
    operator: 'between',
    startDate: new Date(`${period.from}T00:00:00`),
    endDate: new Date(`${period.to}T00:00:00`),
  };
}
