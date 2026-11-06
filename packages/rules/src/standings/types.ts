/** Identificador opaco de time (UUID do `core.participant` ou ID do provedor, à escolha do chamador). */
export type TeamId = string;

export interface CardCount {
  yellow?: number;
  red?: number;
}

/** Resultado final (tempo normal) de uma partida de pontos corridos ou fase de grupos. */
export interface MatchResult {
  id?: string;
  homeId: TeamId;
  awayId: TeamId;
  homeGoals: number;
  awayGoals: number;
  /** Grupo da tabela ('' para tabela única). */
  group?: string;
  /** ISO 8601; ordena a sequência de forma (últimos 5). Sem data, vale a ordem de entrada. */
  playedAt?: string;
  round?: number;
  /** Campo neutro: os gols não contam como "gols fora". */
  neutral?: boolean;
  cards?: { home?: CardCount; away?: CardCount };
  /** Disputa de pênaltis depois do empate (Leagues Cup); só conta com `points.shootout` no regulamento. */
  penalties?: { home: number; away: number };
}

export type FormLetter = 'W' | 'D' | 'L';

/** Totais acumulados de um time. */
export interface TeamRecord {
  teamId: TeamId;
  group: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Dos empates (`drawn`), quantos o time venceu nos pênaltis (só com `points.shootout`). */
  shootoutWon?: number;
  /** Dos empates (`drawn`), quantos o time perdeu nos pênaltis (só com `points.shootout`). */
  shootoutLost?: number;
  goalsFor: number;
  goalsAgainst: number;
  awayGoalsFor: number;
  awayWon: number;
  yellowCards: number;
  redCards: number;
  /** Ajuste de pontos (punições negativas, bonificações positivas). */
  pointsAdjustment: number;
  /** Sequência cronológica (mais antigo → mais recente). */
  form: FormLetter[];
}

/**
 * Linha de uma tabela de partida (ex.: a tabela completa do bootstrap do provedor).
 * Se `points` vier e divergir de V/E/D × pontuação, a diferença vira ajuste de pontos.
 */
export interface BaselineRow {
  teamId: TeamId;
  group?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points?: number;
  awayGoalsFor?: number;
  awayWon?: number;
  yellowCards?: number;
  redCards?: number;
  /** Forma no formato do provedor, ex.: "WWDLW" (mais antigo → mais recente). */
  form?: string;
}

export interface PointsAdjustment {
  teamId: TeamId;
  points: number;
  reason?: string;
}

export interface StandingRow extends TeamRecord {
  rank: number;
  points: number;
  goalDifference: number;
  /** Zona da posição (id da primeira zona do regulamento que contém o rank). */
  zone: string | null;
  /** Times com quem o empate só foi desfeito por sorteio/ordem determinística. */
  unresolvedTieWith: TeamId[];
  /** Critério que separou este time do vizinho de cima (diagnóstico). */
  decidedBy: string | null;
}

export interface StandingsTable {
  group: string;
  rows: StandingRow[];
}
