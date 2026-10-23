/**
 * Futebol australiano (AFL): placar em gols e behinds ("12.14", que somam 86 pontos: 6 por gol e 1 por
 * behind) e a porcentagem da tabela (pontos pró ÷ pontos contra × 100), o primeiro desempate depois dos pontos.
 */
export interface GoalsBehinds {
  goals: number | null;
  behinds: number | null;
}

/** "12.14"; null sem gols ou behinds. */
export function goalsBehinds(gb: GoalsBehinds | null | undefined): string | null {
  return gb?.goals != null && gb.behinds != null ? `${gb.goals}.${gb.behinds}` : null;
}

/** Porcentagem da tabela da AFL com uma casa ("126.7"); null sem pontos sofridos. */
export function aflPercentage(pointsFor: number, pointsAgainst: number): number | null {
  if (!pointsAgainst) return null;
  return Math.round((pointsFor / pointsAgainst) * 1000) / 10;
}
