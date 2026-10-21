/**
 * Regulamentos por competição (config/rules/<slug>.yaml), já normalizados para camelCase.
 * Ver docs/rules/README.md para o formato do YAML.
 */

/** Critérios de desempate, aplicados depois dos pontos, na ordem do regulamento. */
export const TIE_BREAKER_IDS = [
  'wins',
  'goal_difference',
  'goals_for',
  'fewest_goals_against',
  'away_goals_for',
  'away_wins',
  'h2h_points',
  'h2h_goal_difference',
  'h2h_goals_for',
  'h2h_away_goals',
  'fewest_red_cards',
  'fewest_yellow_cards',
  'fair_play',
  'opponents_points',
  'opponents_goal_difference',
  'opponents_goals_for',
  'drawing_of_lots',
] as const;
export type TieBreakerId = (typeof TIE_BREAKER_IDS)[number];

export interface TieBreaker {
  criterion: TieBreakerId;
  /** Só aplica quando o empate envolve no máximo N times (ex.: confronto direto da CBF, só entre dois). */
  maxTeams?: number;
  /** Confronto direto só vale se todos os jogos entre os empatados já foram disputados (LaLiga). */
  requireComplete?: boolean;
}

export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

export interface StandingsRules {
  points: PointsRule;
  tieBreakers: TieBreaker[];
  /** Reaplica os critérios de confronto direto ao subconjunto que continua empatado (padrão UEFA). */
  h2hReapply: boolean;
  /** Pontos disciplinares por cartão para o critério `fair_play` (menor é melhor). */
  fairPlay: { yellow: number; red: number };
}

export const ZONE_KINDS = [
  'qualification',
  'promotion',
  'playoff',
  'relegation_playoff',
  'relegation',
  'elimination',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Faixa de posições com consequência (vaga continental, rebaixamento, eliminação...). */
export interface Zone {
  id: string;
  kind: ZoneKind;
  from: number;
  to: number;
}

export interface LeagueRules {
  /** Número de times por tabela (por grupo, quando houver grupos). */
  teams: number | null;
  /** Jogos de cada time na fase (38 no Brasileirão, 8 na fase de liga da Champions, 6 num grupo da Libertadores). */
  matchesPerTeam: number | null;
  /** Quantas vezes cada par se enfrenta (turno e returno = 2). Usado por `requireComplete`. */
  meetingsPerPair: number;
  /** A tabela define um campeão (falso em fases de grupos e na fase de liga da Champions). */
  title: boolean;
  zones: Zone[];
}

export interface KnockoutStageRules {
  legs: 1 | 2;
  /** Gol fora como critério de desempate do agregado (edições históricas). */
  awayGoals: boolean;
  /** Gol fora também vale na prorrogação (UEFA até 2020/21). */
  awayGoalsInExtraTime: boolean;
  extraTime: boolean;
  penalties: boolean;
  /** Em jogo único, o empate classifica este lado (ex.: 1ª fase da Copa do Brasil: visitante). */
  drawAdvantage: 'home' | 'away' | null;
  neutralVenue: boolean;
  /** O vencedor do confronto é o campeão (final). */
  decidesTitle: boolean;
}

export interface KnockoutRules {
  default: KnockoutStageRules;
  /** Exceções por fase: chave = `core.stage.kind` (final, semi_final, first_round...). */
  stages: Record<string, KnockoutStageRules>;
}

export type CompetitionFormat = 'league' | 'cup' | 'league_phase' | 'groups_and_knockout';

export interface CompetitionRules {
  slug: string;
  name: string;
  format: CompetitionFormat;
  /** Temporada para a qual as exceções (`overrides`) foram resolvidas, se informada. */
  season: number | null;
  standings: StandingsRules;
  league: LeagueRules | null;
  knockout: KnockoutRules | null;
  sources: string[];
}
