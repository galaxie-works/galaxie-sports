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
  /**
   * Empate no confronto (no agregado, ou no jogo único) sem prorrogação nem pênaltis: `better_seed` classifica
   * o de melhor campanha na fase de classificação (Liguilla da Liga MX). A tabela de referência vem de
   * `knockout.seeding`.
   */
  levelAdvantage: 'better_seed' | null;
}

/** Tabela (de `tables:`) que define a melhor campanha nas rodadas de mata-mata que casam com `rounds`. */
export interface KnockoutSeeding {
  rounds: RegExp;
  table: string;
}

export interface KnockoutRules {
  default: KnockoutStageRules;
  /** Exceções por fase: chave = `core.stage.kind` (final, semi_final, first_round...). */
  stages: Record<string, KnockoutStageRules>;
  /** De onde sai a melhor campanha para `level_advantage: better_seed` (vazio sem essa regra). */
  seeding: KnockoutSeeding[];
}

export type CompetitionFormat = 'league' | 'cup' | 'league_phase' | 'groups_and_knockout';

/**
 * Papel de uma tabela da temporada:
 * - `phase`: tabela principal de uma fase (Apertura, Clausura, fase de grupos, pontos corridos);
 * - `annual`: tabela anual/acumulada (soma das fases da temporada);
 * - `relegation_average`: *promedios* (média de pontos de várias temporadas, decide o rebaixamento);
 * - `other`: tabela auxiliar sem cálculo próprio (guardada e exposta como vem do fornecedor).
 */
export const STANDINGS_TABLE_KINDS = ['phase', 'annual', 'relegation_average', 'other'] as const;
export type StandingsTableKind = (typeof STANDINGS_TABLE_KINDS)[number];

/** Nome localizado de uma tabela ou fase (`pt-BR` obrigatório; os demais caem nele). */
export interface TableName {
  'pt-BR': string;
  es?: string;
  en?: string;
}

/**
 * Uma tabela da temporada no regulamento (`tables:` do YAML): quais grupos de `core.standing` são dela, quais
 * rodadas contam no recálculo e o nome exibido. A ordem das fases no YAML é a ordem cronológica.
 */
export interface StandingsTableRule {
  key: string;
  kind: StandingsTableKind;
  name: TableName;
  /** Grupos de `core.standing` (nome do fornecedor, ex.: "Apertura - Group A") que pertencem à tabela. */
  groups: RegExp;
  /** Grupos que casam com `groups` mas não são desta tabela. */
  exclude: RegExp | null;
  /** Rodadas (`core.stage.provider_label`, ex.: "Apertura - 7") que contam no recálculo; null: não recalcula. */
  rounds: RegExp | null;
  /** Como chamar o subgrupo no nome exibido ("Apertura · Zona A"); padrão: Grupo / Grupo / Group. */
  subgroupLabel: TableName | null;
  /** Grupo gravado pelo recálculo quando o fornecedor ainda não mandou a tabela (tabela única da fase). */
  groupName: string | null;
  /**
   * Jogo entre times de grupos diferentes da fase conta na tabela de cada um (fecha interzonal da Argentina);
   * falso: só jogos dentro do grupo entram.
   */
  crossGroupMatches: boolean;
  /** O recálculo grava esta tabela (falso: só a do fornecedor é guardada e exposta, ex.: promedios). */
  computed: boolean;
  /** Matemática própria da tabela (times, jogos, zonas); ausente: a de `league`. */
  league: LeagueRules | null;
}

export interface CompetitionRules {
  slug: string;
  name: string;
  format: CompetitionFormat;
  /** Temporada para a qual as exceções (`overrides`) foram resolvidas, se informada. */
  season: number | null;
  standings: StandingsRules;
  league: LeagueRules | null;
  knockout: KnockoutRules | null;
  /** Tabelas da temporada por fase e auxiliares (vazio: um conjunto de grupos sem papel definido). */
  tables: StandingsTableRule[];
  sources: string[];
}
