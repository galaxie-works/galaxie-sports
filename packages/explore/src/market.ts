/**
 * Bônus de mercado da relevância (docs/06 §3.2), em funções puras: o país dos participantes, o país da competição,
 * a confederação do mercado, a semifinal e a audiência da competição. A explicação completa e a parte que lê o
 * banco (chaves de semifinal, relevância por mercado na resposta) ficam em `apps/api/src/events/relevance.ts`; aqui
 * fica só o que o resumo pré-calculado da home também precisa, para a API e o ingestor darem a mesma nota.
 */
import type { EventRelevance, RelevanceReasonCode } from '@galaxie/contracts';
import { audienceFor, GLOBAL_CONFEDERATION, type GeoConfig, type MarketAudience } from '@galaxie/geo';

export const TEAM_BONUS = 10;
export const COMPETITION_BONUS = 5;
export const OPPONENT_BONUS = 5;
export const MAX_MARKET_BONUS = 10;

/** O código do país pertence ao mercado? (GB cobre GB-ENG, GB-SCT…). */
export function inMarket(code: string | null | undefined, market: string): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return c === market || c.startsWith(`${market}-`);
}

/** Confederação do mercado (GB → a dos membros GB-*). */
function confederationOf(geo: GeoConfig, market: string): string | undefined {
  return (
    geo.country(market)?.confederation ??
    geo.allCountries().find((c) => c.code.startsWith(`${market}-`))?.confederation
  );
}

export interface ContinentalEntry {
  sport: string;
  slug: string;
  /** Confederação dona da competição (a primeira não global do escopo). */
  confederation: string | null;
  /** O mercado entra como convidado (listado em `countries`), não pela confederação. */
  guest: boolean;
}

/**
 * Competições internacionais (por esporte) da confederação do mercado ou que o listam como convidado.
 * As globais (FIFA) ficam de fora: valem para todos os mercados, então não diferenciam nenhum.
 */
export function continentalSlugs(geo: GeoConfig | null, market: string): ContinentalEntry[] {
  if (!geo) return [];
  const conf = confederationOf(geo, market);
  return geo.scopedSports().flatMap((sport) =>
    geo.scopeEntries(sport).flatMap((e): ContinentalEntry[] => {
      const listed = e.countries.some((c) => inMarket(c, market));
      const member =
        conf !== undefined &&
        e.confederations.includes(conf) &&
        !e.confederations.includes(GLOBAL_CONFEDERATION);
      if (!member && !listed) return [];
      return [
        {
          sport,
          slug: e.slug,
          confederation: e.confederations.find((c) => c !== GLOBAL_CONFEDERATION) ?? null,
          guest: !member,
        },
      ];
    }),
  );
}

/** Time do outro lado da chave (semifinal) e onde ele pode cruzar com quem sair deste jogo. */
export interface BracketTeam {
  id: string;
  name: string;
  countryCode: string | null;
  /** `final`: em aberto ou classificado; `third_place`: caiu e há disputa de 3º lugar. */
  round: 'final' | 'third_place';
}

export interface MarketFacts {
  participantCountries: readonly (string | null)[];
  competition: { sport: string; slug: string; countryCode: string | null } | null;
  /** Só na semifinal de mata-mata: os times da outra semifinal. */
  bracket?: readonly BracketTeam[] | undefined;
}

export interface MarketReason {
  code: RelevanceReasonCode;
  points: number;
  /** Times da outra semifinal citados no motivo (`decides_*_opponent`). */
  teams: BracketTeam[];
}

/** Pontos de audiência da competição no mercado para um jogo dessa importância (0 sem config/geo). */
export function audienceOf(
  audience: MarketAudience | null | undefined,
  market: string,
  competition: { sport: string; slug: string } | null | undefined,
  importance: number,
): number {
  if (!audience || !competition) return 0;
  return audienceFor(audience.points(market, competition.sport, competition.slug), importance);
}

/**
 * Bônus de mercado (função pura). `details` traz os pontos de cada motivo; o bônus do país respeita o
 * teto de 10 e a audiência (`audience`, pontos de config/geo/market-audience.yaml) soma por fora.
 */
export function marketBonus(
  market: string,
  facts: MarketFacts,
  continental: ReadonlySet<string>,
  audience = 0,
): { bonus: number; reasons: EventRelevance['reasons']; details: MarketReason[] } {
  const details: MarketReason[] = [];
  if (facts.participantCountries.some((c) => inMarket(c, market)))
    details.push({ code: 'team_from_market', points: TEAM_BONUS, teams: [] });
  const c = facts.competition;
  if (c && inMarket(c.countryCode, market))
    details.push({ code: 'domestic_competition', points: COMPETITION_BONUS, teams: [] });
  else if (c && continental.has(`${c.sport}|${c.slug}`))
    details.push({ code: 'continental_competition', points: COMPETITION_BONUS, teams: [] });
  // semifinal: conta uma vez só, mesmo com dois times do país do outro lado (a final é contra um deles)
  const rivals = (facts.bracket ?? []).filter((t) => inMarket(t.countryCode, market));
  const toFinal = rivals.filter((t) => t.round === 'final');
  if (toFinal.length)
    details.push({ code: 'decides_final_opponent', points: OPPONENT_BONUS, teams: toFinal });
  else if (rivals.length)
    details.push({ code: 'decides_third_place_opponent', points: OPPONENT_BONUS, teams: rivals });
  const bonus =
    Math.min(
      MAX_MARKET_BONUS,
      details.reduce((sum, d) => sum + d.points, 0),
    ) + audience;
  if (audience > 0) details.push({ code: 'market_audience', points: audience, teams: [] });
  return { bonus, reasons: details.map((d) => d.code), details };
}
