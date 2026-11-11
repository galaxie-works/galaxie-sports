/** Cálculos puros da área da Cosmos (período da URL e dias do gráfico), sem banco. */

/** Abas da área da Cosmos (`?tab=`): Moderação e Permissões entram com as issues delas (#997, #996). */
export const COSMOS_TABS = ['overview', 'usage'] as const;
export type CosmosTab = (typeof COSMOS_TABS)[number];

/** Período padrão do extrato e do gráfico: os últimos 30 dias. */
export const DEFAULT_PERIOD_DAYS = 30;
export const DAY = 86_400_000;

export interface StatementParams {
  from?: string;
  to?: string;
  kind?: string[];
  fn?: string[];
  scope?: string[];
  cursor?: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Antes da Cosmos não há extrato; e o período tem teto (o gráfico desenha um ponto por dia). */
export const EARLIEST_DAY = '2026-01-01';
export const MAX_PERIOD_DAYS = 366;

/** Dia (AAAA-MM-DD) de um instante no fuso. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Quanto o fuso está à frente de UTC (ms) naquele instante. */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - at;
}

/** Meia-noite do dia no fuso, como instante. */
export function startOfDayIn(day: string, timeZone: string): Date {
  const utc = Date.parse(`${day}T00:00:00Z`);
  let at = utc - offsetMs(utc, timeZone);
  // troca de horário de verão entre o palpite e a meia-noite: um ajuste resolve
  at = utc - offsetMs(at, timeZone);
  return new Date(at);
}

export const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Período da URL (`from`/`to` em AAAA-MM-DD, `to` inclusive) no fuso de quem olha; inválido ou ausente → últimos
 * 30 dias. Nunca antes de 2026-01-01 nem maior que 366 dias (fica com os 366 que terminam em `to`).
 */
export function periodFrom(
  params: Pick<StatementParams, 'from' | 'to'>,
  now: Date = new Date(),
  timeZone = 'UTC',
) {
  const valid = (v?: string) =>
    v && ISO_DAY.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) ? v : null;
  const today = dayIn(now, timeZone);
  let toDay = valid(params.to) ?? today;
  if (toDay < EARLIEST_DAY) toDay = EARLIEST_DAY;
  let fromDay = valid(params.from);
  if (!fromDay || fromDay > toDay) fromDay = shiftDay(toDay, -(DEFAULT_PERIOD_DAYS - 1));
  const floor = [EARLIEST_DAY, shiftDay(toDay, -(MAX_PERIOD_DAYS - 1))].sort().at(-1)!;
  if (fromDay < floor) fromDay = floor;
  return {
    from: startOfDayIn(fromDay, timeZone),
    to: startOfDayIn(shiftDay(toDay, 1), timeZone),
    fromDay,
    toDay,
    timeZone,
  };
}

/** Dias corridos do período (`fromDay` a `toDay`, inclusive), com 0 nos dias sem uso. */
export function fillDays(rows: readonly { day: string; credits: number }[], fromDay: string, toDay: string) {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.day, (sums.get(r.day) ?? 0) + r.credits);
  const out: { day: string; credits: number }[] = [];
  for (let day = fromDay; day <= toDay && out.length < MAX_PERIOD_DAYS; day = shiftDay(day, 1))
    out.push({ day, credits: Math.round((sums.get(day) ?? 0) * 1000) / 1000 });
  return out;
}

/** O que o aviso do saldo precisa saber da carteira. */
export interface NoticeWallet {
  status: 'active' | 'blocked';
  blockReason: 'depleted' | 'staff' | null;
  alertLevel: number;
  trialRemaining: number;
}

/** O aviso do estado do saldo, do mais grave ao mais leve; nenhum quando está tudo bem. */
export function balanceNotice(w: NoticeWallet): 'blocked' | 'depleted' | 'low90' | 'low80' | 'trial' | null {
  if (w.status === 'blocked') return w.blockReason === 'depleted' ? 'depleted' : 'blocked';
  if (w.alertLevel >= 90) return 'low90';
  if (w.alertLevel >= 80) return 'low80';
  if (w.trialRemaining > 0) return 'trial';
  return null;
}
