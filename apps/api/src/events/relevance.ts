/**
 * Importância global × relevância por mercado (docs/06 §3.2).
 *
 * `importance` (0–100) é global e gravado no banco; a relevância soma um bônus do país pedido e é
 * calculada na requisição (`?market=BR`, ou o único mercado do plano do tenant) — não há coluna por
 * mercado: o bônus depende só do país dos participantes, do país da competição e da confederação, que
 * mudam pouco e cabem numa expressão SQL (ordenação/filtro) e num lookup em lote (resposta).
 *   +10 participante do país do mercado;
 *   +5  competição do país, ou continental/de seleções da confederação do mercado (FIFA/global não conta);
 *   bônus total ≤ 10; score = min(100, importance + bônus).
 */
import { inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Event, EventRelevance, ImportanceBreakdown } from '@galaxie/contracts';
import { competition, event, participant, type Database, type EventImportanceBreakdown } from '@galaxie/db';
import { GLOBAL_CONFEDERATION, loadGeoConfig, type GeoConfig } from '@galaxie/geo';

export const TEAM_BONUS = 10;
export const COMPETITION_BONUS = 5;
export const MAX_MARKET_BONUS = 10;

let defaultGeo: GeoConfig | null | undefined;

/** config/geo carregada uma vez; sem ela, só o bônus de participante e de competição doméstica. */
export function marketGeo(): GeoConfig | null {
  if (defaultGeo === undefined) {
    try {
      defaultGeo = loadGeoConfig();
    } catch {
      defaultGeo = null;
    }
  }
  return defaultGeo;
}

/** `?market=` explícito; senão o mercado do plano quando o tenant tem exatamente um. */
export function resolveMarket(request: FastifyRequest, requested: string | undefined): string | null {
  if (requested) return requested.toUpperCase();
  const markets = request.tenant?.markets ?? [];
  return markets.length === 1 ? markets[0]!.toUpperCase() : null;
}

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

/**
 * Competições internacionais (por esporte) da confederação do mercado ou que o listam como convidado.
 * As globais (FIFA) ficam de fora: valem para todos os mercados, então não diferenciam nenhum.
 */
export function continentalSlugs(geo: GeoConfig | null, market: string): { sport: string; slug: string }[] {
  if (!geo) return [];
  const conf = confederationOf(geo, market);
  return geo.scopedSports().flatMap((sport) =>
    geo
      .scopeEntries(sport)
      .filter(
        (e) =>
          e.countries.some((c) => inMarket(c, market)) ||
          (conf !== undefined &&
            e.confederations.includes(conf) &&
            !e.confederations.includes(GLOBAL_CONFEDERATION)),
      )
      .map((e) => ({ sport, slug: e.slug })),
  );
}

export interface MarketFacts {
  participantCountries: readonly (string | null)[];
  competition: { sport: string; slug: string; countryCode: string | null } | null;
}

/** Bônus de mercado (função pura). */
export function marketBonus(
  market: string,
  facts: MarketFacts,
  continental: ReadonlySet<string>,
): { bonus: number; reasons: EventRelevance['reasons'] } {
  const reasons: EventRelevance['reasons'] = [];
  let bonus = 0;
  if (facts.participantCountries.some((c) => inMarket(c, market))) {
    bonus += TEAM_BONUS;
    reasons.push('team_from_market');
  }
  const c = facts.competition;
  if (c && inMarket(c.countryCode, market)) {
    bonus += COMPETITION_BONUS;
    reasons.push('domestic_competition');
  } else if (c && continental.has(`${c.sport}|${c.slug}`)) {
    bonus += COMPETITION_BONUS;
    reasons.push('continental_competition');
  }
  return { bonus: Math.min(MAX_MARKET_BONUS, bonus), reasons };
}

/** Preenche `relevance` dos eventos já montados (uma consulta por tabela, em lote). */
export async function applyRelevance(
  db: Database,
  events: Event[],
  market: string | null,
  geo: GeoConfig | null = marketGeo(),
): Promise<void> {
  if (!market || !events.length) return;
  const participantIds = [...new Set(events.flatMap((e) => e.participants.map((p) => p.id)))];
  const competitionIds = [...new Set(events.flatMap((e) => (e.competition ? [e.competition.id] : [])))];
  const [parts, comps] = await Promise.all([
    participantIds.length
      ? db
          .select({ id: participant.id, country: participant.countryCode })
          .from(participant)
          .where(inArray(participant.id, participantIds))
      : [],
    competitionIds.length
      ? db
          .select({
            id: competition.id,
            sport: competition.sport,
            slug: competition.slug,
            country: competition.countryCode,
          })
          .from(competition)
          .where(inArray(competition.id, competitionIds))
      : [],
  ]);
  const countryOf = new Map(parts.map((p) => [p.id, p.country]));
  const compOf = new Map(comps.map((c) => [c.id, c]));
  const continental = new Set(continentalSlugs(geo, market).map((c) => `${c.sport}|${c.slug}`));
  for (const e of events) {
    const comp = e.competition ? compOf.get(e.competition.id) : undefined;
    const { bonus, reasons } = marketBonus(
      market,
      {
        participantCountries: e.participants.map((p) => countryOf.get(p.id) ?? null),
        competition: comp ? { sport: comp.sport, slug: comp.slug, countryCode: comp.country } : null,
      },
      continental,
    );
    e.relevance = { market, score: Math.min(100, e.importance + bonus), bonus, reasons };
  }
}

/** Mesma conta em SQL (ordenação `order=relevance` e filtro `relevance_min`). */
export function relevanceSql(market: string, geo: GeoConfig | null = marketGeo()): SQL {
  const like = `${market}-%`;
  const continental = continentalSlugs(geo, market);
  const continentalCond = continental.length
    ? sql` or (c.sport, c.slug) in (${sql.join(
        continental.map((x) => sql`(${x.sport}, ${x.slug})`),
        sql`, `,
      )})`
    : sql``;
  return sql`least(100, ${event.importance} + least(${MAX_MARKET_BONUS},
    (case when exists (select 1 from core.event_participant ep
                         join core.participant p on p.id = ep.participant_id
                        where ep.event_id = ${event.id}
                          and (p.country_code = ${market} or p.country_code like ${like}))
          then ${TEAM_BONUS} else 0 end)
  + (case when exists (select 1 from core.competition c
                        where c.id = ${event.competitionId}
                          and (c.country_code = ${market} or c.country_code like ${like}${continentalCond}))
          then ${COMPETITION_BONUS} else 0 end)))`;
}

/** Detalhamento público do `importance` (sem os campos internos do recálculo). */
export function importanceBreakdownDto(b: EventImportanceBreakdown | null): ImportanceBreakdown | null {
  if (!b) return null;
  const known = new Set(['title', 'relegation', 'elimination', 'qualification']);
  return {
    tier: b.tier,
    phase: b.phase,
    derby: b.derby,
    decisive: b.decisive,
    prestige: b.prestige ?? 0,
    flags: (b.flags ?? []).filter((f): f is ImportanceBreakdown['flags'][number] => known.has(f)),
  };
}
