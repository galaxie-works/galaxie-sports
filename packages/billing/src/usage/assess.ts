import type { ApiModule, ModuleUsageMetric } from '@galaxie/db/schema';
import type { Entitlements } from '../entitlements/resolve.js';

/**
 * Medição ligada à faixa (plataforma comercial F6, #1138): compara o uso do mês com o que o tenant contratou. Nunca
 * desliga nada: aviso em 80% e em 100%, e o que passa da faixa vira excedente (cobrado no fechamento do mês, F4).
 */

/** Uma leitura consolidada do mês (`api.module_usage_monthly`). */
export type UsageReading = { module: ApiModule; metric: ModuleUsageMetric; value: number };

export const USAGE_WARN_RATIO = 0.8;

export type UsageLevel = 'ok' | 'warn' | 'full' | 'over';

export type UsageCheck = {
  /** Faixa do módulo (`live_chat.peak_connections`) ou da capacidade (`capacity.viewsPerMonth`). */
  key: string;
  used: number;
  /** null = sem teto no catálogo (C4, sob reserva): sempre `ok`. */
  limit: number | null;
  level: UsageLevel;
  /** Quanto passou da faixa (0 dentro dela). */
  overage: number;
};

/**
 * Qual medida alimenta cada faixa de módulo. Faixa sem medida aqui (ex.: `communities.max_communities`, contada no
 * cadastro e não no uso) fica de fora da avaliação.
 */
export const TIER_USAGE: Record<string, { module: ApiModule; metric: ModuleUsageMetric }> = {
  'live_chat.peak_connections': { module: 'live_chat', metric: 'peak_connections' },
  'where_to_watch.markets': { module: 'where_to_watch', metric: 'active_markets' },
  'live_intelligence.enriched_games': { module: 'live_intelligence', metric: 'enriched_games' },
};

export function levelOf(used: number, limit: number | null): UsageLevel {
  if (limit === null) return 'ok';
  if (used > limit) return 'over';
  // faixa zero sem uso não pede aviso
  if (used === limit) return used > 0 ? 'full' : 'ok';
  if (used >= limit * USAGE_WARN_RATIO) return 'warn';
  return 'ok';
}

const check = (key: string, used: number, limit: number | null): UsageCheck => ({
  key,
  used,
  limit,
  level: levelOf(used, limit),
  overage: limit === null ? 0 : Math.max(0, used - limit),
});

/**
 * Avalia o mês: as faixas dos módulos que o tenant tem e a faixa de capacidade (visualizações de widget somadas em
 * todos os módulos; pico ao mesmo tempo = maior `peak_connections` de qualquer módulo, uma aproximação enquanto só o
 * chat mede conexões). Em ordem de chave.
 */
export function assessUsage(
  ent: Pick<Entitlements, 'modules' | 'tiers' | 'capacity'> & Partial<Pick<Entitlements, 'isGalaxie'>>,
  readings: readonly UsageReading[],
): UsageCheck[] {
  // o tenant da Galaxie (cliente zero) consome sem cobrança: nada de faixa nem excedente
  if (ent.isGalaxie) return [];
  const value = (module: ApiModule, metric: ModuleUsageMetric) =>
    readings
      .filter((r) => r.module === module && r.metric === metric)
      .reduce((max, r) => Math.max(max, r.value), 0);
  const out: UsageCheck[] = [];
  for (const [key, limit] of Object.entries(ent.tiers)) {
    const source = TIER_USAGE[key];
    if (!source || !ent.modules.includes(source.module)) continue;
    out.push(check(key, value(source.module, source.metric), limit));
  }
  const views = readings.filter((r) => r.metric === 'widget_views').reduce((sum, r) => sum + r.value, 0);
  const peak = readings
    .filter((r) => r.metric === 'peak_connections')
    .reduce((max, r) => Math.max(max, r.value), 0);
  out.push(check('capacity.viewsPerMonth', views, ent.capacity.viewsPerMonth));
  out.push(check('capacity.peakConcurrent', peak, ent.capacity.peakConcurrent));
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** O que pede aviso (80%, 100% ou acima), para o painel e o e-mail. */
export function usageAlerts(checks: readonly UsageCheck[]): UsageCheck[] {
  return checks.filter((c) => c.level !== 'ok');
}
