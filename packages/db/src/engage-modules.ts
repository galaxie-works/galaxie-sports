/**
 * Módulos de engajamento do torcedor (#1017, #1018): ids, faixas por módulo e métricas de uso. Arquivo sem banco
 * (só constantes), para a demo importar por `@galaxie/db/engage-modules` sem levar o cliente do Postgres.
 */

/**
 * Módulos de engajamento: Chat ao vivo (Sala do Jogo), Comunidades, Gamificação, Shopping, Cosmos AI e Verificação de
 * idade (#1109, cobrada por verificação). Ficam fora de todo plano: entram tenant a tenant, por contrato.
 */
export const ENGAGE_MODULES = [
  'live_chat',
  'communities',
  'gamification',
  'shopping',
  'cosmos_ai',
  'age_verification',
] as const;
export type EngageModule = (typeof ENGAGE_MODULES)[number];

export const isEngageModule = (m: string): m is EngageModule =>
  (ENGAGE_MODULES as readonly string[]).includes(m);

/**
 * Faixas por módulo de engajamento (#1018): a Galaxie define padrão e teto; cada tenant tem o valor dele em
 * `api.tenant_module_limit`. `tiers` = só esses valores valem (ex.: pico do chat); sem `tiers`, qualquer inteiro
 * entre `min` e `max`. Valores iniciais, revisados por contrato; preço nunca fica aqui (repo privada).
 */
export const MODULE_LIMITS = {
  /** Pico de conexões simultâneas no Chat ao vivo; acima dele a sala vira só leitura para quem entra (D6). */
  'live_chat.peak_connections': {
    module: 'live_chat',
    min: 5_000,
    max: 100_000,
    default: 5_000,
    tiers: [5_000, 25_000, 100_000],
  },
  /** Comunidades ativas no tenant (uma por Âncora). */
  'communities.max_communities': { module: 'communities', min: 1, max: 500, default: 5, tiers: null },
  /** Programas de Gamificação (um por país do tenant). */
  'gamification.max_programs': { module: 'gamification', min: 1, max: 20, default: 1, tiers: null },
} as const satisfies Record<
  string,
  { module: EngageModule; min: number; max: number; default: number; tiers: readonly number[] | null }
>;
export type ModuleLimitKey = keyof typeof MODULE_LIMITS;
export const MODULE_LIMIT_KEYS = Object.keys(MODULE_LIMITS) as ModuleLimitKey[];

/** Valor aceito para a faixa? (dentro do teto e, quando há faixas fixas, uma delas). */
export function isValidModuleLimit(key: ModuleLimitKey, value: number): boolean {
  const def = MODULE_LIMITS[key];
  if (!Number.isInteger(value) || value < def.min || value > def.max) return false;
  return def.tiers ? (def.tiers as readonly number[]).includes(value) : true;
}

/**
 * Métricas de uso por módulo e mês (#1018; módulos de dados e capacidade desde a plataforma comercial F6, #1138), medidas
 * no Valkey e consolidadas em `api.module_usage_monthly`.
 */
export const MODULE_USAGE_METRICS = {
  /** Torcedores (Perfis) distintos no mês: HyperLogLog, erro ~0,8%. */
  active_fans: 'distinct',
  /** Maior número de conexões simultâneas no mês. */
  peak_connections: 'max',
  /** Cliques de saída (Shopping). */
  clicks: 'count',
  /** Créditos consumidos (Cosmos AI). */
  credits: 'count',
  /** Visualizações de widget (sinal do widget; soma de todos os módulos = visualizações da faixa de capacidade). */
  widget_views: 'count',
  /** Jogos enriquecidos no mês (Live Intelligence: franquia do plano e add-on medido acima dela). */
  enriched_games: 'count',
  /** Países distintos com uso no mês (Where to Watch: faixa de países). HyperLogLog. */
  active_markets: 'distinct',
  /** Verificações de idade cobradas pelo provedor e resolvidas só pela estimativa do rosto (#1109). */
  age_checks_estimate: 'count',
  /** Verificações de idade cobradas que passaram pelo documento (zona de dúvida da estimativa ou documento direto, #1109). */
  age_checks_document: 'count',
} as const;
export type ModuleUsageMetric = keyof typeof MODULE_USAGE_METRICS;
type MetricsOfKind<K> = {
  [M in ModuleUsageMetric]: (typeof MODULE_USAGE_METRICS)[M] extends K ? M : never;
}[ModuleUsageMetric];
/** Métricas somadas. */
export type CountUsageMetric = MetricsOfKind<'count'>;
/** Métricas de membros distintos (HyperLogLog). */
export type DistinctUsageMetric = MetricsOfKind<'distinct'>;
export const COUNT_USAGE_METRICS = (Object.keys(MODULE_USAGE_METRICS) as ModuleUsageMetric[]).filter(
  (m) => MODULE_USAGE_METRICS[m] === 'count',
) as CountUsageMetric[];
export const DISTINCT_USAGE_METRICS = (Object.keys(MODULE_USAGE_METRICS) as ModuleUsageMetric[]).filter(
  (m) => MODULE_USAGE_METRICS[m] === 'distinct',
) as DistinctUsageMetric[];
