/**
 * Linhas da seção "Estatísticas" da página do jogo, a partir de `GET /v1/events/{id}/stats` (códigos
 * estáveis da API): ordem fixa, valor de cada lado e qual lado leva o destaque.
 *
 * Regra do destaque: o maior valor da linha vai em pílula com a cor do time — exceto onde **menor é
 * melhor** (faltas, impedimentos e cartões), em que o destaque vai para o menor. Empate (ou um lado sem
 * número) não destaca ninguém.
 */
import type { EventStats, TeamStatisticCode } from '@galaxie/contracts';

/** Ordem da seção; códigos fora da lista não aparecem. */
export const STAT_ORDER: readonly TeamStatisticCode[] = [
  'possession_pct',
  'shots_total',
  'shots_on_goal',
  'xg',
  'passes_total',
  'pass_accuracy_pct',
  'corners',
  'fouls',
  'offsides',
  'yellow_cards',
  'red_cards',
  'saves',
];

/** Onde menor é melhor: o destaque vai para o menor valor. */
export const LOWER_IS_BETTER: ReadonlySet<TeamStatisticCode> = new Set([
  'fouls',
  'offsides',
  'yellow_cards',
  'red_cards',
]);

/** Contagens: a api-sports manda `null` para zero (ex.: "Red Cards"). xG e percentuais não. */
const NOT_COUNTS: ReadonlySet<TeamStatisticCode> = new Set(['xg', 'possession_pct', 'pass_accuracy_pct']);

export interface StatRow {
  code: TeamStatisticCode;
  /** Rótulo da API (no locale pedido), para quando a demo não tiver o código no dicionário. */
  label: string;
  home: number | null;
  away: number | null;
  /** Lado destacado (pílula com a cor do time) ou `null` no empate. */
  best: 'home' | 'away' | null;
  /** Fração do mandante na barra (0–1); `null` sem barra (os dois zerados ou sem número). */
  share: number | null;
}

export function statRows(stats: EventStats | null | undefined): StatRow[] {
  if (!stats?.available || stats.teams.length < 2) return [];
  const home = stats.teams.find((t) => t.team.side === 'home') ?? stats.teams[0]!;
  const away = stats.teams.find((t) => t.team.side === 'away') ?? stats.teams[1]!;
  const rows: StatRow[] = [];
  for (const code of STAT_ORDER) {
    const h = home.statistics.find((s) => s.code === code);
    const a = away.statistics.find((s) => s.code === code);
    if (!h && !a) continue;
    const zero = NOT_COUNTS.has(code) ? null : 0;
    const hv = h?.numeric ?? zero;
    const av = a?.numeric ?? zero;
    if (hv == null && av == null) continue;
    let best: StatRow['best'] = null;
    if (hv != null && av != null && hv !== av) {
      const homeHigher = hv > av;
      best = homeHigher !== LOWER_IS_BETTER.has(code) ? 'home' : 'away';
    }
    const total = (hv ?? 0) + (av ?? 0);
    rows.push({
      code,
      label: (h ?? a)!.label,
      home: hv,
      away: av,
      best,
      share: hv != null && av != null && total > 0 ? hv / total : null,
    });
  }
  return rows;
}
