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
 * Faixas de capacidade da organização (`config/catalog/capacity.yaml`; C3 e C4 só por proposta, PL7, R3). Definição
 * única (#1446), aqui por ser arquivo sem banco: a tela de cliente da demo importa sem levar o Postgres. O check
 * constraint `organization_capacity_tier` repete a lista (faixa nova = migration) e um teste confere os dois; o
 * catálogo recusa subir sem cada faixa.
 */
export const CAPACITY_TIERS = ['C1', 'C2', 'C3', 'C4'] as const;
export type CapacityTier = (typeof CAPACITY_TIERS)[number];

/**
 * Faixas por módulo de engajamento (#1018) que o tenant ajusta em `api.tenant_module_limit`: a chave e o módulo dono.
 * Os **valores** (padrão, mínimo, máximo e faixas fixas) moram em `config/catalog/modules.yaml` (`tiers` do módulo) e
 * chegam pelo `@galaxie/billing` (`moduleLimitDefs(catalog)`, #1446): mudar um teto é editar o yaml, não o código. A
 * chave fica aqui porque o código a lê (o chat conta o pico, as Comunidades contam o teto); o catálogo recusa subir
 * sem cada chave desta lista.
 */
export const MODULE_LIMIT_MODULES = {
  /** Pico de conexões simultâneas no Chat ao vivo; acima dele a sala vira só leitura para quem entra (D6). */
  'live_chat.peak_connections': 'live_chat',
  /** Comunidades ativas no tenant (uma por Âncora). */
  'communities.max_communities': 'communities',
  /** Programas de Gamificação (um por país do tenant). */
  'gamification.max_programs': 'gamification',
} as const satisfies Record<string, EngageModule>;
export type ModuleLimitKey = keyof typeof MODULE_LIMIT_MODULES;
export const MODULE_LIMIT_KEYS = Object.keys(MODULE_LIMIT_MODULES) as ModuleLimitKey[];

/**
 * Definição de uma faixa, como o catálogo a entrega: `tiers` = só esses valores valem (ex.: pico do chat); `null` =
 * qualquer inteiro entre `min` e `max`.
 */
export interface ModuleLimitDef {
  module: EngageModule;
  min: number;
  max: number;
  default: number;
  tiers: readonly number[] | null;
}
export type ModuleLimitDefs = Readonly<Record<ModuleLimitKey, ModuleLimitDef>>;

/** Valor aceito para a faixa? (dentro do teto e, quando há faixas fixas, uma delas). */
export function isValidModuleLimit(def: ModuleLimitDef, value: number): boolean {
  if (!Number.isInteger(value) || value < def.min || value > def.max) return false;
  return def.tiers ? def.tiers.includes(value) : true;
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
