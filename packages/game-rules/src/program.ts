/**
 * Pedaços do programa que o Palpite precisa sem banco: os assuntos do Palpite de quantidade com o Piso de cada
 * esporte do MVP (futebol, basquete e futebol americano) e o fuso de cada país para o mês do Ranking.
 *
 * O Piso fica aqui até o Catálogo (#910) ganhar a tela em Ajustes; aí passa a vir do banco, com estes valores de
 * padrão. Só entram assuntos que o placar já traz: o total de pontos (gols, cestas, pontos) do jogo.
 */
import type { MatchOutcome } from './prediction.js';

/** Total de pontos do jogo (gols no futebol, pontos no basquete e no futebol americano). */
export const TOTAL_SCORE = 'total_score';

/** Piso do Palpite de quantidade por esporte e assunto. Esporte fora daqui não tem Palpite de quantidade. */
export const QUANTITY_FLOORS: Readonly<Record<string, Readonly<Record<string, number>>>> = Object.freeze({
  football: { [TOTAL_SCORE]: 1 },
  basketball: { [TOTAL_SCORE]: 150 },
  nba: { [TOTAL_SCORE]: 180 },
  'american-football': { [TOTAL_SCORE]: 20 },
});

/** Esportes do MVP com Palpite. */
export const PREDICTION_SPORTS: readonly string[] = Object.freeze(Object.keys(QUANTITY_FLOORS));

export const quantityFloors = (sport: string): Readonly<Record<string, number>> =>
  QUANTITY_FLOORS[sport] ?? {};

/** Resultado para a pontuação a partir do placar do jogo. Sem placar (jogo não começou), null. */
export function outcomeFromScore(
  score: { home: number | null; away: number | null } | null | undefined,
): MatchOutcome | null {
  if (!score || score.home === null || score.away === null) return null;
  return { home: score.home, away: score.away, totals: { [TOTAL_SCORE]: score.home + score.away } };
}

/** Fuso de cada país do programa, para o mês do Ranking. País com vários fusos usa o da capital ou do maior mercado. */
export const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = Object.freeze({
  AR: 'America/Argentina/Buenos_Aires',
  BO: 'America/La_Paz',
  BR: 'America/Sao_Paulo',
  CA: 'America/Toronto',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  CR: 'America/Costa_Rica',
  EC: 'America/Guayaquil',
  ES: 'Europe/Madrid',
  GT: 'America/Guatemala',
  MX: 'America/Mexico_City',
  PA: 'America/Panama',
  PE: 'America/Lima',
  PT: 'Europe/Lisbon',
  PY: 'America/Asuncion',
  US: 'America/New_York',
  UY: 'America/Montevideo',
  VE: 'America/Caracas',
});

export const countryTimeZone = (country: string): string => COUNTRY_TIME_ZONES[country] ?? 'UTC';
