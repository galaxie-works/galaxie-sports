/**
 * Relevância por mercado e prioridade do onde assistir (docs/07 §2.2).
 *
 * Adaptador: a relevância por mercado é calculada pela API na requisição
 * (apps/api/src/events/relevance.ts) e não fica gravada no banco. Até existir um cálculo
 * compartilhado, usamos a mesma conta aqui: `core.event.importance` + 10 se um participante é do país
 * do mercado, + 5 se a competição é do país (bônus do país ≤ 10) + a audiência da competição no
 * mercado (config/geo/market-audience.yaml, a mesma da API); teto 100. (O bônus continental e o da
 * semifinal da API não entram — só mudam copas continentais sem time do país.)
 */
import { audienceFor, loadGeoConfig, type MarketAudience } from '@galaxie/geo';

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
  /** Esporte e slug da competição (audiência no mercado). */
  competition?: { sport: string; slug: string } | null;
}

let defaultAudience: MarketAudience | null | undefined;

/** Audiência de config/geo (`GEO_CONFIG_DIR`), carregada uma vez; sem a pasta, nenhuma competição soma. */
export function marketAudience(): MarketAudience | null {
  if (defaultAudience === undefined) {
    try {
      defaultAudience = loadGeoConfig().audience;
    } catch (err) {
      console.warn(
        `config/geo indisponível (${err instanceof Error ? err.message : String(err)}): relevância sem audiência.`,
      );
      defaultAudience = null;
    }
  }
  return defaultAudience;
}

/** Relevância (0–100) do jogo para o mercado. */
export function marketRelevance(
  facts: RelevanceFacts,
  market: string,
  audience: MarketAudience | null = marketAudience(),
): number {
  let bonus = 0;
  if (facts.participantCountries.some((c) => inMarket(c, market))) bonus += TEAM_BONUS;
  if (inMarket(facts.competitionCountry, market)) bonus += COMPETITION_BONUS;
  const importance = Math.max(0, facts.importance);
  const points = audienceFor(
    audience?.points(market, facts.competition?.sport, facts.competition?.slug) ?? 0,
    importance,
  );
  return Math.min(100, importance + Math.min(MAX_MARKET_BONUS, bonus) + points);
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
  /**
   * Alocação por rodada em T-48h (`wtw-run`, desenho anterior). Desligada por padrão: o canal de cada
   * jogo sai do job `wtw-channel` (T-5d, T-48h, T-6h e depois do jogo). Ausente = ligada (legado).
   */
  roundAllocation?: boolean;
}

/**
 * WTW_MIN_RELEVANCE (padrão 60), WTW_DAILY_USD_PER_MARKET (padrão 1; 0 ou "unlimited" = sem teto) e
 * WTW_ROUND_ALLOCATION (padrão off: o canal do jogo é do job `wtw-channel`).
 */
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
  const roundAllocation = ['on', 'true', '1'].includes(env.WTW_ROUND_ALLOCATION?.trim().toLowerCase() ?? '');
  return { minRelevance, dailyUsdPerMarket, roundAllocation };
}
