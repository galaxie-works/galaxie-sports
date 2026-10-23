/**
 * Datas e números no idioma escolhido e no fuso de quem está vendo. Os formatadores do Intl custam caro
 * para criar: ficam guardados por (idioma, fuso).
 */
import type { Locale } from './config';

export interface Formatters {
  locale: Locale;
  timeZone: string;
  /** "sáb., 24 de out. de 2026, 16:00" */
  dateTime: (iso: string) => string;
  /** "sábado, 24 de outubro de 2026" */
  dateLong: (iso: string) => string;
  /** "16:00" */
  time: (iso: string) => string;
  /** "24/10/26" */
  shortDate: (iso: string) => string;
  /** "24 de out. de 2026" (instante, no fuso) */
  date: (iso: string) => string;
  /** "24 de out. de 2026, 16:00" */
  dayTime: (iso: string) => string;
  /** Data de calendário sem hora (`2026-10-24`, ex.: nascimento): "24/10/2026", sem efeito de fuso. */
  calendarDate: (ymd: string) => string;
  /** "45.000" / "45,000" */
  number: (n: number) => string;
  /** "há 3 horas", "em 5 dias", "agora" (relativo a `now`). */
  relative: (iso: string, now?: number) => string;
}

const cache = new Map<string, Formatters>();

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function createFormatters(locale: Locale, timeZone: string): Formatters {
  const key = `${locale}|${timeZone}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Horário de 24 h no Brasil e na Argentina (o padrão do ICU para es-AR é 12 h, "04:00 p. m."); em
  // inglês, 12 h sem zero à esquerda ("4:00 PM").
  const dtf = (options: Intl.DateTimeFormatOptions) => {
    const hours: Intl.DateTimeFormatOptions = !options.hour
      ? {}
      : locale === 'en'
        ? { hourCycle: 'h12', hour: 'numeric' }
        : { hourCycle: 'h23' };
    const f = new Intl.DateTimeFormat(locale, { timeZone, ...options, ...hours });
    return (iso: string) => f.format(new Date(iso));
  };
  const calendar = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const numberFmt = new Intl.NumberFormat(locale);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const formatters: Formatters = {
    locale,
    timeZone,
    // Com o ano: no confronto direto e na campanha os cards misturam temporadas.
    dateTime: dtf({
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    dateLong: dtf({ weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
    time: dtf({ hour: '2-digit', minute: '2-digit' }),
    shortDate: dtf({ day: '2-digit', month: '2-digit', year: '2-digit' }),
    date: dtf({ day: '2-digit', month: 'short', year: 'numeric' }),
    dayTime: dtf({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    calendarDate: (ymd) => calendar.format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`)),
    number: (n) => numberFmt.format(n),
    relative: (iso, now = Date.now()) => {
      const seconds = (new Date(iso).getTime() - now) / 1000;
      for (const [unit, size] of RELATIVE_UNITS) {
        if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
      }
      return rtf.format(0, 'second');
    },
  };
  cache.set(key, formatters);
  return formatters;
}

/** Data de calendário (`2026-05-03`) no idioma, sem fuso: serve fora das partes dinâmicas. */
export const calendarDate = (locale: Locale, ymd: string) =>
  createFormatters(locale, 'UTC').calendarDate(ymd);
