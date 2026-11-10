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

/** Período da URL (`from`/`to` em AAAA-MM-DD, `to` inclusive); inválido ou ausente → últimos 30 dias. */
export function periodFrom(params: Pick<StatementParams, 'from' | 'to'>, now: Date = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const parse = (v?: string) => (v && ISO_DAY.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN);
  let to = parse(params.to);
  let from = parse(params.from);
  if (!Number.isFinite(to)) to = today;
  if (!Number.isFinite(from) || from > to) from = to - (DEFAULT_PERIOD_DAYS - 1) * DAY;
  return { from: new Date(from), to: new Date(to + DAY) };
}

/** Dias corridos do período, com 0 nos dias sem uso. */
export function fillDays(rows: readonly { day: string; credits: number }[], from: Date, to: Date) {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.day, (sums.get(r.day) ?? 0) + r.credits);
  const out: { day: string; credits: number }[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, credits: Math.round((sums.get(day) ?? 0) * 1000) / 1000 });
  }
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
