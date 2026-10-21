/**
 * Geração de iCalendar (RFC 5545) para eventos: linhas CRLF, dobra em 75 octetos, texto escapado
 * e horários sempre em UTC (sufixo Z), independentes do `tz` pedido.
 */

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Última alteração do evento (LAST-MODIFIED e SEQUENCE). */
  updatedAt: Date;
  categories?: string[];
}

/** Instante no formato UTC do iCalendar: 20261022T003000Z. */
export function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Escapa TEXT (RFC 5545 §3.3.11): barra invertida, ponto e vírgula, vírgula e quebras de linha. */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Dobra linhas com mais de 75 octetos (UTF-8) sem quebrar caracteres multibyte (§3.1). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

/** VCALENDAR com um VEVENT por evento. */
export function buildIcs(events: IcsEvent[], options: { now?: Date; calendarName?: string } = {}): string {
  const now = options.now ?? new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Galaxie Sports//API v1//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (options.calendarName) lines.push(`X-WR-CALNAME:${icsEscape(options.calendarName)}`);
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(icsEscape).join(',')}`);
    lines.push(
      `STATUS:${e.status}`,
      `LAST-MODIFIED:${icsDate(e.updatedAt)}`,
      `SEQUENCE:${Math.max(0, Math.floor(e.updatedAt.getTime() / 1000) - 1_700_000_000)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
