// Estatísticas de exemplo do Clube Aurora na Liga Exemplo (`/v1/teams/{id}/statistics`) para a prévia do
// Builder e os testes do widget Estatísticas do time (#893). Segue o contrato `TeamStatistics` de @galaxie/contracts.
import type { TeamSeasonStatistics, TeamStatistics } from '@galaxie/contracts';

const ha = (home: number, away: number) => ({ home, away, total: home + away });
const avg = (home: number, away: number, total: number) => ({ home, away, total });
const minutes = (counts: number[]) =>
  counts.flatMap((count, i) => (count ? [{ from: i === 0 ? 0 : i * 15 + 1, to: (i + 1) * 15, count }] : []));

/** A temporada de exemplo (2026) e a anterior, para o seletor e para a opção de temporada. */
function season(
  competition: TeamSeasonStatistics['competition'],
  year: number,
  scale: number,
): TeamSeasonStatistics {
  return {
    competition,
    season: { year, label: String(year) },
    form: 'WWDLWWDWLW',
    record: {
      played: ha(17 * scale, 17 * scale),
      won: ha(11 * scale, 7 * scale),
      drawn: ha(4 * scale, 5 * scale),
      lost: ha(2 * scale, 5 * scale),
    },
    goals: {
      scored: ha(31 * scale, 21 * scale),
      conceded: ha(12 * scale, 19 * scale),
      scored_average: avg(1.8, 1.2, 1.5),
      conceded_average: avg(0.7, 1.1, 0.9),
      scored_by_minute: minutes([6, 8, 9, 7, 10, 12].map((n) => n * scale)),
      conceded_by_minute: minutes([3, 5, 4, 6, 5, 8].map((n) => n * scale)),
      scored_lines: [{ line: 2.5, over: 9 * scale, under: 25 * scale }],
      conceded_lines: [{ line: 2.5, over: 3 * scale, under: 31 * scale }],
    },
    clean_sheets: ha(9 * scale, 5 * scale),
    failed_to_score: ha(2 * scale, 4 * scale),
    streaks: { wins: 6, draws: 2, losses: 2 },
    biggest: {
      win: { home: { for: 5, against: 0 }, away: { for: 3, against: 0 } },
      loss: { home: { for: 0, against: 2 }, away: { for: 1, against: 3 } },
      scored: { home: 5, away: 3 },
      conceded: { home: 2, away: 3 },
    },
    penalties: { scored: 6, missed: 1, total: 7 },
    formations: [
      { formation: '4-2-3-1', played: 19 * scale },
      { formation: '4-3-3', played: 10 * scale },
      { formation: '3-5-2', played: 5 * scale },
    ],
    cards: {
      yellow: 74 * scale,
      red: 3,
      yellow_by_minute: minutes([4, 9, 14, 12, 16, 19].map((n) => n * scale)),
      red_by_minute: [
        { from: 31, to: 45, count: 1 },
        { from: 76, to: 90, count: 2 },
      ],
    },
    updated_at: `${year}-11-06T09:00:00.000Z`,
  };
}

export function previewTeamStats(
  teamId: string,
  competition: { id: string; slug: string; name: string; logo: string | null },
  query: { competition?: string | null; season?: number | null } = {},
): TeamStatistics {
  const seasons = [season(competition, 2026, 1), season(competition, 2025, 1)];
  const wanted = query.competition;
  const data =
    seasons.find(
      (s) =>
        (!wanted || wanted === competition.id || wanted === competition.slug) &&
        (!query.season || s.season.year === query.season),
    ) ?? null;
  return {
    team_id: teamId,
    sport: 'football',
    data,
    available: seasons.map((s) => ({ competition: s.competition, season: s.season })),
  };
}
