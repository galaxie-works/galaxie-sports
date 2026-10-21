import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  competition,
  games,
  gamesCompetition,
  gamesProviderLeague,
  providerMap,
  season,
  type Database,
} from '@galaxie/db';

const DAY = 86_400_000;

export interface SeasonLike {
  year: number;
  startDate: string | null;
  endDate: string | null;
}

export interface GamesLike {
  id: string;
  type: string;
  season: string;
  year: number;
  startDate: string;
  endDate: string;
}

/**
 * Edição dos Jogos correspondente a uma temporada do provedor. Preferência pelas datas (o torneio de futebol
 * começa antes da abertura — janela de 21 dias antes até 3 dias depois); sem datas, cai para o ano.
 * Resolve rótulos enganosos (ex.: temporada "2020" jogada em 2021, "2023" do vôlei olímpico = Paris 2024).
 */
export function matchSeasonToGames<G extends GamesLike>(
  s: SeasonLike,
  candidates: G[],
): { games: G; matchedBy: 'date_overlap' | 'year' } | null {
  if (s.startDate && s.endDate) {
    const start = Date.parse(s.startDate);
    const end = Date.parse(s.endDate);
    const hit = candidates.find(
      (g) => start <= Date.parse(g.endDate) + 3 * DAY && end >= Date.parse(g.startDate) - 21 * DAY,
    );
    return hit ? { games: hit, matchedBy: 'date_overlap' } : null;
  }
  const byYear = candidates.find((g) => g.year === s.year);
  return byYear ? { games: byYear, matchedBy: 'year' } : null;
}

export interface LinkReport {
  linked: {
    games: string;
    sport: string;
    gender: string;
    providerLeagueId: string;
    competition: string;
    season: number;
    matchedBy: string;
  }[];
  /** Ligas sem competição no core (catálogo do esporte ainda não carregado). */
  pending: { sport: string; providerLeagueId: string; label: string }[];
  /** Temporadas do provedor sem edição correspondente (ex.: pré-olímpico, datas fora da janela). */
  unmatchedSeasons: { competition: string; season: number }[];
}

/**
 * Liga as competições dos esportes coletivos (core.competition, via core.provider_map da api-sports)
 * às edições dos Jogos. Zero chamadas ao provedor: usa apenas o catálogo já gravado. Idempotente.
 */
export async function linkGamesCompetitions(db: Database): Promise<LinkReport> {
  const report: LinkReport = { linked: [], pending: [], unmatchedSeasons: [] };
  const leagues = await db.select().from(gamesProviderLeague);
  const allGames = await db
    .select({
      id: games.id,
      slug: games.slug,
      type: games.type,
      season: games.season,
      year: games.year,
      startDate: games.startDate,
      endDate: games.endDate,
    })
    .from(games);

  for (const league of leagues) {
    const [mapped] = await db
      .select({ id: providerMap.entityId, name: competition.name, slug: competition.slug })
      .from(providerMap)
      .innerJoin(competition, eq(competition.id, providerMap.entityId))
      .where(
        and(
          eq(providerMap.provider, league.provider),
          eq(providerMap.sport, league.sport),
          eq(providerMap.entityType, 'competition'),
          eq(providerMap.providerId, league.providerLeagueId),
        ),
      )
      .limit(1);
    if (!mapped) {
      report.pending.push({
        sport: league.sport,
        providerLeagueId: league.providerLeagueId,
        label: league.label,
      });
      continue;
    }
    const candidates = allGames.filter((g) => g.type === league.gamesType && g.season === league.gamesSeason);
    const seasons = await db.select().from(season).where(eq(season.competitionId, mapped.id));
    for (const s of seasons) {
      const match = matchSeasonToGames(s, candidates);
      if (!match) {
        report.unmatchedSeasons.push({ competition: mapped.slug, season: s.year });
        continue;
      }
      await db
        .insert(gamesCompetition)
        .values({
          gamesId: match.games.id,
          competitionId: mapped.id,
          seasonId: s.id,
          sport: league.sport,
          gender: league.gender,
          provider: league.provider,
          providerLeagueId: league.providerLeagueId,
          matchedBy: match.matchedBy,
        })
        .onConflictDoUpdate({
          target: [gamesCompetition.gamesId, gamesCompetition.competitionId],
          set: {
            seasonId: sql`excluded.season_id`,
            gender: sql`excluded.gender`,
            matchedBy: sql`excluded.matched_by`,
          },
        });
      report.linked.push({
        games: match.games.slug,
        sport: league.sport,
        gender: league.gender,
        providerLeagueId: league.providerLeagueId,
        competition: mapped.slug,
        season: s.year,
        matchedBy: match.matchedBy,
      });
    }
  }
  report.linked.sort((a, b) => a.games.localeCompare(b.games) || a.competition.localeCompare(b.competition));
  return report;
}

/** Competições/temporadas do core ligadas a uma edição (ex.: futebol masculino e feminino de Paris 2024). */
export async function competitionsForGames(db: Database, gamesSlugs: string[]) {
  return db
    .select({
      games: games.slug,
      sport: gamesCompetition.sport,
      gender: gamesCompetition.gender,
      competitionId: competition.id,
      competition: competition.name,
      seasonId: gamesCompetition.seasonId,
      providerLeagueId: gamesCompetition.providerLeagueId,
    })
    .from(gamesCompetition)
    .innerJoin(games, eq(games.id, gamesCompetition.gamesId))
    .innerJoin(competition, eq(competition.id, gamesCompetition.competitionId))
    .where(inArray(games.slug, gamesSlugs));
}
