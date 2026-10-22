/**
 * Estatísticas de time da api-sports football (`fixtures/statistics`, guardadas em
 * `core.football_fixture.detail.statistics`): o `type` do fornecedor ("Ball Possession", "Shots insidebox",
 * "expected_goals"…) vira um código estável e o valor ("54%", "0.64", 12) vira número. Usado pela API
 * (`GET /v1/events/{id}/stats`) e pelo agente de resumo pós-jogo, para os dois lerem igual.
 */

/** Códigos estáveis das estatísticas de time (docs/05 §3.2). */
export const TEAM_STATISTIC_CODES = [
  'possession_pct',
  'shots_total',
  'shots_on_goal',
  'shots_off_goal',
  'shots_blocked',
  'shots_inside_box',
  'shots_outside_box',
  'xg',
  'goals_prevented',
  'passes_total',
  'passes_accurate',
  'pass_accuracy_pct',
  'corners',
  'free_kicks',
  'fouls',
  'offsides',
  'yellow_cards',
  'red_cards',
  'saves',
] as const;
export type TeamStatisticCode = (typeof TEAM_STATISTIC_CODES)[number];

/** `type` do fornecedor → código (comparação sem diferenciar maiúsculas; a api-sports varia a grafia). */
const BY_PROVIDER_TYPE = new Map<string, TeamStatisticCode>(
  Object.entries({
    'ball possession': 'possession_pct',
    'total shots': 'shots_total',
    'shots on goal': 'shots_on_goal',
    'shots off goal': 'shots_off_goal',
    'blocked shots': 'shots_blocked',
    'shots insidebox': 'shots_inside_box',
    'shots outsidebox': 'shots_outside_box',
    expected_goals: 'xg',
    goals_prevented: 'goals_prevented',
    'total passes': 'passes_total',
    'passes accurate': 'passes_accurate',
    'passes %': 'pass_accuracy_pct',
    'corner kicks': 'corners',
    'free kicks': 'free_kicks',
    fouls: 'fouls',
    offsides: 'offsides',
    'yellow cards': 'yellow_cards',
    'red cards': 'red_cards',
    'goalkeeper saves': 'saves',
  }) as [string, TeamStatisticCode][],
);

/** Código estável de um `type` do fornecedor; `null` para tipos que ainda não mapeamos. */
export function teamStatisticCode(type: string | null | undefined): TeamStatisticCode | null {
  if (!type) return null;
  return BY_PROVIDER_TYPE.get(type.trim().toLowerCase()) ?? null;
}

/** Valor numérico: `12` → 12, `"54%"` → 54, `"0.64"` → 0.64; `null`, vazio ou texto → `null`. */
export function teamStatisticNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(value);
  return m ? Number(m[1]!.replace(',', '.')) : null;
}

export interface NormalizedTeamStatistic {
  /** `type` cru do fornecedor (nos derivados, repete o código). */
  type: string;
  /** Valor como o fornecedor mandou (`"54%"`, `0.64`…); nos derivados, o número. */
  value: number | string | null;
  code: TeamStatisticCode | null;
  numeric: number | null;
  /** `provider`: veio do fornecedor; `derived`: calculada a partir de outras (ex.: precisão de passe). */
  source: 'provider' | 'derived';
}

/**
 * Normaliza a lista de um time, na ordem do fornecedor. Sem "Passes %" mas com passes certos e totais, a
 * precisão de passe entra como derivada (`passes_accurate / passes_total`, arredondada).
 */
export function normalizeTeamStatistics(
  raw: readonly { type?: string | null; value?: unknown }[] | null | undefined,
): NormalizedTeamStatistic[] {
  const out: NormalizedTeamStatistic[] = (raw ?? []).map((s) => {
    const value = typeof s.value === 'number' || typeof s.value === 'string' ? s.value : null;
    return {
      type: String(s.type ?? ''),
      value,
      code: teamStatisticCode(s.type),
      numeric: teamStatisticNumber(value),
      source: 'provider',
    };
  });
  const num = (code: TeamStatisticCode) => out.find((s) => s.code === code)?.numeric ?? null;
  const accurate = num('passes_accurate');
  const total = num('passes_total');
  if (!out.some((s) => s.code === 'pass_accuracy_pct') && accurate != null && total) {
    const pct = Math.round((accurate / total) * 100);
    out.push({
      type: 'pass_accuracy_pct',
      value: pct,
      code: 'pass_accuracy_pct',
      numeric: pct,
      source: 'derived',
    });
  }
  return out;
}

/** Mapa código → número de um time (sem os tipos não mapeados nem os valores sem número). */
export function teamStatisticValues(
  raw: readonly { type?: string | null; value?: unknown }[] | null | undefined,
): Partial<Record<TeamStatisticCode, number>> {
  const out: Partial<Record<TeamStatisticCode, number>> = {};
  for (const s of normalizeTeamStatistics(raw)) if (s.code && s.numeric != null) out[s.code] = s.numeric;
  return out;
}
