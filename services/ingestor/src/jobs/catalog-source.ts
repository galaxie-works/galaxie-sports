import { and, asc, eq, lte } from 'drizzle-orm';
import { competition, country, providerMap, season, type Database } from '@galaxie/db';

/** Flags de cobertura por temporada vindas de /leagues (core.season.coverage). */
export interface Coverage {
  fixtures?: {
    events?: boolean;
    lineups?: boolean;
    statistics_fixtures?: boolean;
    statistics_players?: boolean;
  };
  standings?: boolean;
  players?: boolean;
  top_scorers?: boolean;
  top_assists?: boolean;
  top_cards?: boolean;
  injuries?: boolean;
  predictions?: boolean;
  odds?: boolean;
}

export type CoverageFlag = Exclude<keyof Coverage, 'fixtures'>;

/** Cobertura desconhecida (null) não bloqueia; só `false` explícito evita a chamada. */
export function covers(coverage: Coverage | null, flag: CoverageFlag): boolean {
  return coverage?.[flag] !== false;
}

/** O detalhe de partida só vale a pena se houver eventos, escalações ou estatísticas. */
export function coversFixtureDetail(coverage: Coverage | null): boolean {
  const f = coverage?.fixtures;
  if (!f) return true;
  return (
    f.events !== false ||
    f.lineups !== false ||
    f.statistics_fixtures !== false ||
    f.statistics_players !== false
  );
}

export interface SeasonInfo {
  year: number;
  current: boolean;
  startDate: string | null;
  endDate: string | null;
  coverage: Coverage | null;
}

export interface CompetitionInfo {
  /** ID da liga na api-sports. */
  leagueId: number;
  slug: string;
  name: string;
  type: 'league' | 'cup' | 'tournament' | 'multisport';
  tier: number;
  livePriority: string;
  countryCode: string | null;
  /** Nome do país em inglês, como a api-sports o espera em `?country=`. */
  countryName: string | null;
  seasons: SeasonInfo[];
}

/** Catálogo já carregado no core (bootstrap:catalog): competições, tiers, temporadas e cobertura. */
export interface CatalogSource {
  competitions(maxTier: number): Promise<CompetitionInfo[]>;
}

export class StaticCatalogSource implements CatalogSource {
  constructor(private readonly items: CompetitionInfo[]) {}

  async competitions(maxTier: number): Promise<CompetitionInfo[]> {
    return this.items.filter((c) => c.tier <= maxTier);
  }
}

const LIVE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** Ordem de prioridade do bootstrap: tier, depois `live_priority`, depois o slug (estável). */
export function compareCompetitions(a: CompetitionInfo, b: CompetitionInfo): number {
  return (
    a.tier - b.tier ||
    (LIVE_ORDER[a.livePriority] ?? 9) - (LIVE_ORDER[b.livePriority] ?? 9) ||
    a.slug.localeCompare(b.slug)
  );
}

export class PgCatalogSource implements CatalogSource {
  constructor(private readonly db: Database) {}

  async competitions(maxTier: number): Promise<CompetitionInfo[]> {
    const rows = await this.db
      .select({
        id: competition.id,
        leagueId: providerMap.providerId,
        slug: competition.slug,
        name: competition.name,
        type: competition.type,
        tier: competition.tier,
        livePriority: competition.livePriority,
        countryCode: competition.countryCode,
        countryName: country.name,
      })
      .from(competition)
      .innerJoin(
        providerMap,
        and(
          eq(providerMap.entityId, competition.id),
          eq(providerMap.entityType, 'competition'),
          eq(providerMap.provider, 'api-sports'),
          eq(providerMap.sport, 'football'),
        ),
      )
      .leftJoin(country, eq(country.code, competition.countryCode))
      .where(and(eq(competition.sport, 'football'), lte(competition.tier, maxTier)));
    if (!rows.length) return [];

    const seasons = await this.db
      .select({
        competitionId: season.competitionId,
        year: season.year,
        current: season.current,
        startDate: season.startDate,
        endDate: season.endDate,
        coverage: season.coverage,
      })
      .from(season)
      .innerJoin(competition, eq(competition.id, season.competitionId))
      .where(and(eq(competition.sport, 'football'), lte(competition.tier, maxTier)))
      .orderBy(asc(season.year));
    const byCompetition = new Map<string, SeasonInfo[]>();
    for (const s of seasons) {
      const list = byCompetition.get(s.competitionId) ?? [];
      list.push({
        year: s.year,
        current: s.current,
        startDate: s.startDate,
        endDate: s.endDate,
        coverage: (s.coverage as Coverage | null) ?? null,
      });
      byCompetition.set(s.competitionId, list);
    }

    return rows
      .map((r): CompetitionInfo => ({
        leagueId: Number(r.leagueId),
        slug: r.slug,
        name: r.name,
        type: r.type,
        tier: r.tier,
        livePriority: r.livePriority,
        countryCode: r.countryCode,
        countryName: r.countryCode === 'WORLD' ? null : (r.countryName?.en ?? null),
        seasons: byCompetition.get(r.id) ?? [],
      }))
      .sort(compareCompetitions);
  }
}
