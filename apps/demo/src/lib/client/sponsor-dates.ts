/**
 * Dias da vigência do patrocinador no fuso do cliente (#1021). O formulário trabalha com dias (`YYYY-MM-DD`); o banco
 * guarda instantes. Início = 00:00 do dia no fuso; fim = 00:00 do dia seguinte (o fim é exclusivo em `sponsorVisible`,
 * então o último dia digitado conta inteiro).
 */

/** Diferença entre a hora local no fuso e UTC, em ms, no instante `t`. */
function offsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - Math.floor(t / 1000) * 1000;
}

/** 00:00 do dia `ymd` no fuso, em ISO (UTC). */
export function startOfDay(ymd: string, timeZone: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  // duas passadas: o offset pode mudar entre o palpite e o resultado (horário de verão)
  let t = wall - offsetMs(wall, timeZone);
  t = wall - offsetMs(t, timeZone);
  // meia-noite que não existe (horário de verão que começa às 00:00, como em Santiago): o dia começa no primeiro
  // instante que já é dele, depois da hora que o relógio pulou
  if (dayIn(new Date(t).toISOString(), timeZone) !== ymd)
    t += offsetMs(t + 6 * 3600_000, timeZone) - offsetMs(t, timeZone);
  return new Date(t).toISOString();
}

/** Dia (`YYYY-MM-DD`) do instante no fuso. */
export function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

const nextDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Campo "Início" → instante. */
export const startsAtOf = (ymd: string, timeZone: string) => (ymd ? startOfDay(ymd, timeZone) : null);
/** Campo "Fim" (último dia que conta) → instante exclusivo (00:00 do dia seguinte). */
export const endsAtOf = (ymd: string, timeZone: string) => (ymd ? startOfDay(nextDay(ymd), timeZone) : null);
/** Instante do banco → campo "Início". */
export const startDayOf = (iso: string | null, timeZone: string) => (iso ? dayIn(iso, timeZone) : '');
/** Instante exclusivo do banco → campo "Fim" (o dia anterior ao fim). */
export const endDayOf = (iso: string | null, timeZone: string) =>
  iso ? dayIn(new Date(Date.parse(iso) - 1).toISOString(), timeZone) : '';
