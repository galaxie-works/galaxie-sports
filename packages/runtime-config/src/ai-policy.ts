/**
 * Política de execução da IA (issue #357): o teto global do dia é dividido em faixas por prioridade, e o dia
 * de orçamento vira num horário local (padrão 06:00 em Brasília), não à meia-noite UTC. Este módulo é puro
 * (sem banco): o registro do painel valida por ele, o ledger (@galaxie/ai-ledger) e o painel calculam por ele.
 *
 * Faixas (`AI_BAND_SHARES`, em % do AI_DAILY_USD_BUDGET, soma 100):
 * - `p0`: futebol LATAM (competição com audiência ≥ AI_P0_MIN_AUDIENCE num mercado);
 * - `reserve`: reserva que só a P0 usa, depois de gastar a própria faixa;
 * - `p1`: o resto do futebol que o produto cobre (audiência abaixo do corte);
 * - `clients`: entregas por cliente e a grade das operadoras (listas de canais, lineups);
 * - `rest`: os demais (editorial, revisão, competição sem audiência);
 * - `manual`: qualquer execução fora do scheduler (CLI rodada à mão), seja qual for o agente.
 * Uma faixa que acaba não pega saldo de nenhuma outra: a chamada é recusada e o job segue com o determinístico.
 */
import type { ValidationError } from './resolve.js';

export const AI_BANDS = ['p0', 'reserve', 'p1', 'clients', 'rest', 'manual'] as const;
export type AiBand = (typeof AI_BANDS)[number];
/** Faixas em que uma chamada cai (a reserva não é destino: é o colchão da P0). */
export const AI_CALL_BANDS = ['p0', 'p1', 'clients', 'rest', 'manual'] as const;
export type AiCallBand = (typeof AI_CALL_BANDS)[number];

/**
 * Padrão das faixas, calibrado no gasto de 21 a 25/10 (#357), com o teto global de US$ 10:
 * - p0=45 (+ reserve=10 = US$ 5,50): cobre wtw 3 + context 1,5 + related 0,5 = US$ 5, o máximo que os tetos
 *   por agente deixam o futebol gastar num dia (wtw chegou a 6,29 e context a 4,02 antes desses tetos);
 * - p1=15 (US$ 1,50): o futebol fora do corte (as europeias) no canal do jogo, no resumo e no cenário;
 * - clients=15 (US$ 1,50): lineups (teto 2; o dia de 15,54 em 24/10 foi antes do #293) e channels;
 * - rest=5 (US$ 0,50): review (teto 0,5);
 * - manual=10 (US$ 1): os lotes rodados à mão (fotos ~US$ 4 em 25/10, f1profile 1,32) andam ~US$ 1 por
 *   dia e continuam no dia seguinte; com 3% (US$ 0,30) levariam mais de 13 dias.
 * O inventário propunha 55/10/15/12/5/3; a P0 cedeu 10 pontos (5 para a manual, 3 para clientes) sem
 * travar o futebol, porque os tetos por agente já seguram esses agentes abaixo dos 55%.
 */
export const DEFAULT_BAND_SHARES: Readonly<Record<AiBand, number>> = {
  p0: 45,
  reserve: 10,
  p1: 15,
  clients: 15,
  rest: 5,
  manual: 10,
};

/** `p0=55,reserve=10,…` na ordem de AI_BANDS (o mesmo conjunto grava sempre o mesmo texto). */
export function formatBandShares(shares: Readonly<Record<AiBand, number>>): string {
  return AI_BANDS.map((b) => `${b}=${shares[b]}`).join(',');
}

export const DEFAULT_BAND_SHARES_TEXT = formatBandShares(DEFAULT_BAND_SHARES);

const BAND_ENTRY = /^([a-z0-9]+)=(\d{1,3})$/i;

/**
 * Confere AI_BAND_SHARES: as seis faixas, uma vez cada, inteiros de 0 a 100, somando 100. Devolve as
 * porcentagens ou o erro (código `format` para formato e faixa desconhecida, `shares` para a soma).
 */
export function checkBandShares(
  raw: string,
): { ok: true; shares: Record<AiBand, number> } | { ok: false; error: ValidationError } {
  const out: Partial<Record<AiBand, number>> = {};
  for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
    const m = BAND_ENTRY.exec(part);
    const band = m?.[1]!.toLowerCase() as AiBand | undefined;
    if (!m || !band || !AI_BANDS.includes(band) || out[band] !== undefined)
      return { ok: false, error: { code: 'format' } };
    const n = Number(m[2]);
    if (n > 100) return { ok: false, error: { code: 'range', min: 0, max: 100 } };
    out[band] = n;
  }
  const missing = AI_BANDS.filter((b) => out[b] === undefined);
  if (missing.length) return { ok: false, error: { code: 'format', values: missing } };
  const sum = AI_BANDS.reduce((s, b) => s + out[b]!, 0);
  if (sum !== 100) return { ok: false, error: { code: 'shares', detail: String(sum) } };
  return { ok: true, shares: out as Record<AiBand, number> };
}

/** AI_BAND_SHARES lido (vazio = padrão); inválido → null. */
export function parseBandShares(raw: string | null | undefined): Record<AiBand, number> | null {
  if (!raw?.trim()) return { ...DEFAULT_BAND_SHARES };
  const checked = checkBandShares(raw);
  return checked.ok ? checked.shares : null;
}

/**
 * Teto em US$ de cada faixa de chamada no dia: a % do teto global; a P0 soma a reserva (que só ela usa).
 * Sem teto global (`unlimited`), as faixas também ficam sem teto.
 */
export function bandLimitsUsd(
  dailyUsd: number | null,
  shares: Readonly<Record<AiBand, number>>,
): Record<AiCallBand, number | null> {
  const of = (pct: number) => (dailyUsd === null ? null : Math.round(dailyUsd * pct * 100) / 10_000);
  return {
    p0: of(shares.p0 + shares.reserve),
    p1: of(shares.p1),
    clients: of(shares.clients),
    rest: of(shares.rest),
    manual: of(shares.manual),
  };
}

/** Dia de orçamento: começa em `start` (HH:MM) no fuso `timeZone`. */
export interface BudgetDay {
  timeZone: string;
  start: string;
}

/** Padrão: 06:00 em Brasília, depois da última janela de jogo da noite (a rodada noturna fica num dia só). */
export const DEFAULT_BUDGET_DAY: Readonly<BudgetDay> = { timeZone: 'America/Sao_Paulo', start: '06:00' };
/** Dia UTC (o comportamento antigo; testes e quem não passa a configuração). */
export const UTC_BUDGET_DAY: Readonly<BudgetDay> = { timeZone: 'UTC', start: '00:00' };

export const BUDGET_DAY_START_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Fuso IANA aceito pelo Node (ex.: America/Sao_Paulo, UTC). */
export function isTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Data e minutos do dia locais do instante no fuso (o relógio local, com horário de verão). */
function localClock(
  at: Date,
  timeZone: string,
): { year: number; month: number; day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    minutes: (get('hour') % 24) * 60 + get('minute'),
  };
}

/**
 * Dia de orçamento do instante (YYYY-MM-DD): a data local de `at`, ou a da véspera se o relógio local
 * ainda não chegou ao horário de início. Lê a hora local do fuso (não subtrai horas do instante), então
 * acerta a virada nos dias de troca do horário de verão. Com o padrão, 26/10 às 05:59 em Brasília ainda é
 * o dia 25; às 06:00 começa o 26.
 */
export function budgetDayOf(at: Date, day: Readonly<BudgetDay> = UTC_BUDGET_DAY): string {
  const c = localClock(at, day.timeZone);
  const before = c.minutes < minutesOf(day.start) ? 1 : 0;
  return new Date(Date.UTC(c.year, c.month - 1, c.day - before)).toISOString().slice(0, 10);
}

/**
 * Código de saída do job que gravou a saída determinística porque o orçamento recusou (faixa esgotada):
 * o scheduler registra a execução como `budget_skipped`, não como erro.
 */
export const EXIT_BUDGET_SKIPPED = 75;

/** "06:00 (America/Sao_Paulo)": como a virada aparece nos avisos. */
export const describeBudgetDay = (day: Readonly<BudgetDay>) => `${day.start} (${day.timeZone})`;
