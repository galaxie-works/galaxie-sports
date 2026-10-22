/**
 * Relevância por mercado e prioridade do onde assistir (docs/07 §2.2).
 *
 * Adaptador: a relevância por mercado (importância + até +10 quando times/competição são do
 * mercado) é calculada pela API na requisição (apps/api/src/events/relevance.ts) e não fica gravada
 * no banco. Até existir um cálculo compartilhado, usamos a mesma conta aqui: `core.event.importance`
 * + 10 se um participante é do país do mercado, + 5 se a competição é do país; bônus total ≤ 10;
 * teto 100. (O bônus continental da API não entra — só muda copas continentais sem time do país.)
 */

export const TEAM_BONUS = 10;
export const COMPETITION_BONUS = 5;
export const MAX_MARKET_BONUS = 10;
export const DEFAULT_MIN_RELEVANCE = 60;
export const DEFAULT_DAILY_USD_PER_MARKET = 1;

/** O código do país pertence ao mercado? (GB cobre GB-ENG, GB-SCT…). */
export function inMarket(code: string | null | undefined, market: string): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return c === market || c.startsWith(`${market}-`);
}

export interface RelevanceFacts {
  importance: number;
  participantCountries: readonly (string | null)[];
  competitionCountry: string | null;
}

/** Relevância (0–100) do jogo para o mercado. */
export function marketRelevance(facts: RelevanceFacts, market: string): number {
  let bonus = 0;
  if (facts.participantCountries.some((c) => inMarket(c, market))) bonus += TEAM_BONUS;
  if (inMarket(facts.competitionCountry, market)) bonus += COMPETITION_BONUS;
  return Math.min(100, Math.max(0, facts.importance) + Math.min(MAX_MARKET_BONUS, bonus));
}

/** Prioridade = relevância × proximidade do início (1 no apito; 1/3 a 48 h). */
export function priorityOf(relevance: number, startsAt: Date, now: Date): number {
  const hours = Math.max(0, (startsAt.getTime() - now.getTime()) / 3_600_000);
  return Math.round((relevance / (1 + hours / 24)) * 100) / 100;
}

export interface WtwPolicy {
  /** Relevância mínima (no mercado) para gastar LLM na alocação por rodada. */
  minRelevance: number;
  /** Teto diário de US$ por mercado (custo das chamadas rateado pelos mercados de cada uma). */
  dailyUsdPerMarket: number | null;
}

/** WTW_MIN_RELEVANCE (padrão 60) e WTW_DAILY_USD_PER_MARKET (padrão 1; 0 ou "unlimited" = sem teto). */
export function wtwPolicyFromEnv(env: Record<string, string | undefined> = process.env): WtwPolicy {
  const rel = env.WTW_MIN_RELEVANCE?.trim();
  const minRelevance = rel ? Number(rel) : DEFAULT_MIN_RELEVANCE;
  if (!Number.isFinite(minRelevance) || minRelevance < 0 || minRelevance > 100)
    throw new Error('WTW_MIN_RELEVANCE precisa ser um número entre 0 e 100.');
  const usd = env.WTW_DAILY_USD_PER_MARKET?.trim().toLowerCase();
  let dailyUsdPerMarket: number | null = DEFAULT_DAILY_USD_PER_MARKET;
  if (usd === 'unlimited' || usd === '0') dailyUsdPerMarket = null;
  else if (usd) {
    dailyUsdPerMarket = Number(usd);
    if (!Number.isFinite(dailyUsdPerMarket) || dailyUsdPerMarket < 0)
      throw new Error('WTW_DAILY_USD_PER_MARKET precisa ser um número ≥ 0 (ou "unlimited").');
  }
  return { minRelevance, dailyUsdPerMarket };
}
