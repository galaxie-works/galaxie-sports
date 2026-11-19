/**
 * Piso de "escalados desde" dos perfis, fotos e Wikidata: 1º de janeiro do ano anterior ao corrente, nunca antes do
 * começo da base atual. Em 2026 dá 2026-01-01 (o valor que estava fixo); em 2027 continua 2026-01-01; em 2028 vira
 * 2027-01-01, e assim por diante, sem data presa no código.
 */
export const BASE_START_YEAR = 2026;

export function recentSinceYear(now: Date = new Date()): number {
  return Math.max(BASE_START_YEAR, now.getUTCFullYear() - 1);
}

/** O piso como data (meia-noite UTC de 1º de janeiro). */
export function recentSince(now: Date = new Date()): Date {
  return new Date(Date.UTC(recentSinceYear(now), 0, 1));
}

/** O piso como AAAA-MM-DD, para o padrão de `--desde` das CLIs. */
export function recentSinceDay(now: Date = new Date()): string {
  return `${recentSinceYear(now)}-01-01`;
}
