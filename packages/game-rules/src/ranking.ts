/**
 * Ranking único por cliente e país, mensal e anual (#942). O desempate nunca é por sorte: mais Acertos em cheio,
 * depois quem chegou primeiro ao total.
 */
export interface RankingEntry {
  points: number;
  fullHits: number;
  /** Quando o Perfil chegou ao total atual. */
  reachedAt: Date;
}

/** Ordem do Ranking (negativo = `a` na frente). */
export function compareRanking(a: RankingEntry, b: RankingEntry): number {
  return b.points - a.points || b.fullHits - a.fullHits || a.reachedAt.getTime() - b.reachedAt.getTime();
}

/** Chave do período: mês (`2026-11`) ou ano (`2026`), no fuso do país do programa. O jogo conta no mês em que começou. */
export function periodKeys(startsAt: Date, timeZone: string): { month: string; year: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(startsAt);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return { month: `${year}-${month}`, year };
}

/** Período válido: `AAAA` ou `AAAA-MM`. */
export const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
