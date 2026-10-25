/**
 * Orçamento da cota do YouTube no Conteúdo relacionado (docs/12 §8). A Data API tem dois baldes por projeto:
 * - **busca** (`search.list`): 100 consultas/dia por padrão, contadas em consultas, num balde próprio;
 * - **geral** (`videos`, `channels`, `playlistItems`): 10.000 unidades/dia, 1 por chamada (lote de 50).
 * A busca é o recurso escasso: os canais conhecidos (1 unidade por página de uploads) vêm primeiro e a busca
 * só complementa. O dia de cota (meia-noite do Pacífico) não pode ser gasto inteiro na primeira rodada: parte
 * do balde de busca fica reservada aos jogos que ainda vão acontecer no dia, pela agenda e pela prioridade.
 * Tudo em código, sem chamadas.
 */
import { inMarket } from '../wtw/relevance.js';

/** Consultas `search.list` por dia (cota padrão do projeto; acima disso, só com pedido ao Google). */
export const DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA = 100;
/** Unidades por dia do balde geral (videos, channels, playlistItems). */
export const DEFAULT_YOUTUBE_DAILY_QUOTA = 10_000;
/** Parte dos dois baldes que o agente nunca gasta (folga para execuções manuais). */
export const DEFAULT_QUOTA_RESERVE_PERCENT = 10;

/**
 * Peso de cada mercado na prioridade: o Brasil é o mercado principal; os demais pesam menos. Um jogo das 21h
 * no Brasil (relevância 95 × 1) passa à frente da sobra da madrugada no México (91 × 0,6).
 */
export const DEFAULT_MARKET_WEIGHTS: Readonly<Record<string, number>> = {
  BR: 1,
  AR: 0.6,
  MX: 0.6,
  CO: 0.45,
  CL: 0.4,
  PE: 0.35,
  UY: 0.35,
  EC: 0.35,
};
/** Peso de um mercado ativo sem peso definido. */
export const FALLBACK_MARKET_WEIGHT = 0.3;

/** Janela do rendimento histórico por competição. */
export const YIELD_DAYS = 14;
/** Buscas "a priori" na média global (suaviza competição com pouco histórico). */
export const YIELD_PRIOR_SEARCHES = 4;
/** Buscas sem nenhum vídeo publicado para a competição cair para o fim da fila. */
export const ZERO_YIELD_MIN_SEARCHES = 6;
export const MIN_YIELD_FACTOR = 0.3;
export const MAX_YIELD_FACTOR = 1.5;

/** "BR:1,AR:0.6" → { BR: 1, AR: 0.6 }; vazio ou inválido → null (usa o padrão). */
export function parseMarketWeights(raw: string | undefined | null): Record<string, number> | null {
  const text = raw?.trim();
  if (!text) return null;
  const out: Record<string, number> = {};
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^([A-Za-z]{2}):(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return null;
    out[m[1]!.toUpperCase()] = Math.min(1, Number(m[2]));
  }
  return Object.keys(out).length ? out : null;
}

export interface BucketState {
  limit: number;
  used: number;
}

export interface QuotaState {
  search: BucketState;
  api: BucketState;
}

/** Limites úteis dos dois baldes: cota do projeto menos a folga. */
export function bucketLimits(input: { searchDaily: number; apiDaily: number; reservePercent: number }): {
  search: number;
  api: number;
} {
  const keep = 1 - Math.min(90, Math.max(0, input.reservePercent)) / 100;
  return { search: Math.floor(input.searchDaily * keep), api: Math.floor(input.apiDaily * keep) };
}

/** Prioridade do jogo: maior (relevância no mercado × peso do mercado) entre os mercados ativos. */
export function marketScore(
  byMarket: Readonly<Record<string, number>>,
  weights: Readonly<Record<string, number>>,
): number {
  let best = 0;
  for (const [m, rel] of Object.entries(byMarket))
    best = Math.max(best, rel * (weights[m] ?? FALLBACK_MARKET_WEIGHT));
  return best;
}

/** Histórico de uma competição na janela (`competitionYields` em store.ts). */
export interface CompetitionYieldRow {
  competitionId: string;
  slug: string;
  games: number;
  searches: number;
  apiUnits: number;
  /** Vídeos publicados achados pela busca. */
  searchVideos: number;
  /** Vídeos publicados achados nos canais conhecidos. */
  channelVideos: number;
}

export interface YieldFactor {
  /** Multiplicador da prioridade (0,3–1,5). */
  factor: number;
  /** Vídeos publicados por consulta (suavizado). */
  perSearch: number;
  /** Rendimento zero recorrente: vai para o fim da fila. */
  zero: boolean;
}

/**
 * Rendimento histórico por competição: vídeos publicados pela busca ÷ consultas, suavizado pela média global
 * (`YIELD_PRIOR_SEARCHES` consultas "a priori"), em raiz para não esmagar a relevância. Competição com
 * `ZERO_YIELD_MIN_SEARCHES` ou mais consultas e nenhum vídeo é rendimento zero recorrente.
 */
export function yieldFactors(rows: readonly CompetitionYieldRow[]): Map<string, YieldFactor> {
  const totalSearches = rows.reduce((a, r) => a + r.searches, 0);
  const totalVideos = rows.reduce((a, r) => a + r.searchVideos, 0);
  const global = totalSearches > 0 && totalVideos > 0 ? totalVideos / totalSearches : 1;
  const out = new Map<string, YieldFactor>();
  for (const r of rows) {
    const perSearch = (r.searchVideos + YIELD_PRIOR_SEARCHES * global) / (r.searches + YIELD_PRIOR_SEARCHES);
    const factor = Math.min(MAX_YIELD_FACTOR, Math.max(MIN_YIELD_FACTOR, Math.sqrt(perSearch / global)));
    out.set(r.competitionId, {
      factor: Math.round(factor * 1000) / 1000,
      perSearch: Math.round(perSearch * 100) / 100,
      zero: r.searches >= ZERO_YIELD_MIN_SEARCHES && r.searchVideos === 0 && r.channelVideos === 0,
    });
  }
  return out;
}

/** 0 = mercado ativo · 1 = fora dos mercados (Europa) · 2 = rendimento zero recorrente. */
export type QueueGroup = 0 | 1 | 2;

/**
 * Jogo fora dos mercados: nem a competição nem algum participante é de um mercado ativo (Premier League,
 * LaLiga, Champions sem time sul-americano). A Libertadores (sem país, times dos mercados) não é.
 */
export function isForeign(input: {
  competitionCountry: string | null;
  participantCountries: readonly (string | null)[];
  markets: readonly string[];
}): boolean {
  return !input.markets.some(
    (m) => inMarket(input.competitionCountry, m) || input.participantCountries.some((c) => inMarket(c, m)),
  );
}

export function queueGroup(input: { foreign: boolean; zeroYield: boolean }): QueueGroup {
  if (input.zeroYield) return 2;
  return input.foreign ? 1 : 0;
}

/** Jogo da agenda (ainda vai acontecer ou está em andamento) que termina dentro do dia de cota. */
export interface UpcomingGame {
  id: string;
  startsAt: Date;
  score: number;
  /** Consultas que o jogo deve precisar (1 com canal conhecido, senão o teto por execução). */
  expected: number;
}

/** Consultas que um jogo deve precisar: com canal oficial, a busca só complementa (1); sem, o teto da execução. */
export function expectedSearches(input: { channels: number; maxSearchesPerRun: number }): number {
  return input.channels > 0 ? Math.min(1, input.maxSearchesPerRun) : input.maxSearchesPerRun;
}

/**
 * Reserva do balde de busca que este jogo NÃO pode tocar: as consultas esperadas dos jogos da agenda com
 * prioridade maior que a dele (jogo fora dos mercados ou de rendimento zero: a agenda inteira), com teto
 * de `capPercent` do balde. É o que impede a primeira rodada do dia (07:00 UTC, sobra da madrugada) de gastar
 * a cota dos jogos grandes da noite.
 */
export function reserveFor(input: {
  score: number;
  group: QueueGroup;
  upcoming: readonly UpcomingGame[];
  searchLimit: number;
  capPercent: number;
}): number {
  const cap = Math.floor((input.searchLimit * Math.max(0, input.capPercent)) / 100);
  if (cap <= 0) return 0;
  const ahead = input.group === 0 ? input.upcoming.filter((u) => u.score > input.score) : input.upcoming;
  return Math.min(
    cap,
    ahead.reduce((a, u) => a + u.expected, 0),
  );
}

/** Reserva total em vigor (a que o jogo de menor prioridade enxerga): o painel mostra como "reservada". */
export function totalReserve(input: {
  upcoming: readonly UpcomingGame[];
  searchLimit: number;
  capPercent: number;
}): number {
  return reserveFor({ ...input, score: -1, group: 1 });
}

/**
 * Consultas que o jogo pode gastar agora: o livre do balde (limite − gasto − reserva dos de prioridade maior),
 * o teto da execução e o que sobra do teto do jogo.
 */
export function searchAllowance(input: {
  search: BucketState;
  reserve: number;
  maxSearchesPerRun: number;
  maxSearchesPerEvent: number;
  searchesSoFar: number;
  /** Rendimento zero recorrente: no máximo uma consulta. */
  zeroYield?: boolean;
}): number {
  const free = input.search.limit - input.search.used - input.reserve;
  const perRun = input.zeroYield ? Math.min(1, input.maxSearchesPerRun) : input.maxSearchesPerRun;
  return Math.max(0, Math.min(free, perRun, input.maxSearchesPerEvent - input.searchesSoFar));
}
