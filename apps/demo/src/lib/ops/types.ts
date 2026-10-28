/**
 * Dados do painel de Operação (Ajustes → Operação), já serializáveis: o servidor monta, o navegador só
 * desenha. Segredos chegam só como `configured`; nenhum valor de credencial sai do servidor.
 */
import type { RuntimeService, SettingSource, SettingSection } from '@galaxie/runtime-config';

export interface OpsSetting {
  key: string;
  section: SettingSection;
  /** Valor efetivo; `null` = vazio (o serviço usa o comportamento padrão dele). */
  value: string | null;
  source: SettingSource;
  defaultValue: string | null;
  envValue: string | null;
  override: string | null;
  overrideInvalid: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  /** Segredos: definido no contêiner de referência. */
  configured: boolean;
  /** Quando o contêiner de referência relatou o env (null = nunca relatou). */
  reportedAt: string | null;
  /** cron: próximas execuções do valor efetivo (UTC, ISO). */
  nextRuns: string[];
}

export interface ServiceStatus {
  service: RuntimeService;
  reportedAt: string | null;
  /** Scheduler relatando dentro do esperado (a API relata só na partida). */
  alive: boolean;
}

export interface JobRunSummary {
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  trigger: string | null;
}

export interface JobStatus {
  name: string;
  service: 'ingestor' | 'agents';
  runNow: boolean;
  last: JobRunSummary | null;
  lastOkAt: string | null;
  errors24h: number;
  /** Pedido de "rodar agora" ainda não concluído. */
  queued: { status: string; requestedAt: string; requestedBy: string } | null;
}

export interface QuotaRow {
  api: string;
  plan: string | null;
  dailyLimit: number | null;
  providerUsed: number | null;
  providerLimit: number | null;
  capturedAt: string | null;
  used: Record<string, number>;
  totalUsed: number;
  planned: Record<string, number>;
}

export interface LlmAgentSpend {
  agent: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd: number;
  errors: number;
  /** Chamadas com mais buscas na web que AI_MAX_SEARCHES_PER_CALL. */
  overSearchCap: number;
}

export interface LlmSpend {
  totals: Omit<LlmAgentSpend, 'agent'>;
  byAgent: LlmAgentSpend[];
  /** AI_STATUS efetivo: off = nenhuma chamada ao LLM. */
  status: 'on' | 'off';
  /** AI_AGENT_STATUS: estado de cada agente listado (`on` e os outros seguem o global; o global off vence). */
  agentStatus: Record<string, 'on' | 'off'>;
  /** Flags de estado/teto com valor efetivo inválido (`CHAVE=valor`), ex.: 0 vindo do env. */
  invalid: string[];
  /** Orçamento efetivo (tokens/dia); null = sem limite. */
  budget: number | null;
  /** Orçamento efetivo em US$/dia (tokens + buscas); null = sem limite. */
  usdBudget: number | null;
  /** Teto em US$/dia de cada agente (AI_AGENT_USD_BUDGETS); null = sem teto próprio. */
  agentUsdBudgets: Record<string, number | null>;
  /** De onde vem o teto de cada agente: painel (`db`), env do contêiner ou padrão do código. */
  agentUsdOrigins: Record<string, 'db' | 'env' | 'code'>;
  /** Teto em US$/dia do agente fora de `agentUsdBudgets` (AI_AGENT_DEFAULT_USD_BUDGET); null = só o global. */
  agentDefaultUsdBudget: number | null;
  /** Buscas na web por chamada; null = sem teto. */
  maxSearchesPerCall: number | null;
}

export interface CreditStatus {
  status: 'pass' | 'warn' | 'fail';
  /** ok | no_key | ai_off | http | network */
  code: string;
  provider: string | null;
  model: string | null;
  http: number | null;
  error: string | null;
  checkedAt: string;
}

export interface HistoryRow {
  id: number;
  key: string;
  action: 'set' | 'reset';
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
}

export interface JobRequestRow {
  id: string;
  job: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  finishedAt: string | null;
  detail: string | null;
}

/** Rendimento de uma competição no Conteúdo relacionado (14 dias, enrich.related_run × related_content). */
export interface YoutubeYieldRow {
  slug: string;
  games: number;
  searches: number;
  apiUnits: number;
  searchVideos: number;
  channelVideos: number;
}

export interface YoutubeSkippedRow {
  eventId: string;
  label: string;
  competition: string | null;
  relevance: number;
  score: number;
  reason: string;
  at: string;
}

/**
 * Cota do YouTube no dia de cota (meia-noite do Pacífico), nos dois baldes: busca (consultas, com a parte
 * reservada aos jogos que ainda vão acontecer) e geral (unidades). Vem do orçamento que o `related:run` grava.
 */
export interface YoutubeSnapshot {
  quotaDay: string;
  /** Última gravação do orçamento (null: o agente ainda não rodou no dia; os limites vêm das flags). */
  updatedAt: string | null;
  search: { limit: number; used: number; reserved: number };
  api: { limit: number; used: number };
  channels: { club: number; competition: number; broadcaster: number };
  yields: YoutubeYieldRow[];
  skipped: YoutubeSkippedRow[];
}

export interface OpsSnapshot {
  generatedAt: string;
  dayUtc: string;
  settings: OpsSetting[];
  services: ServiceStatus[];
  jobs: JobStatus[];
  quota: QuotaRow[];
  llm: LlmSpend;
  credit: CreditStatus | null;
  creditPending: boolean;
  history: HistoryRow[];
  requests: JobRequestRow[];
  /** Placar da qualidade dos dados (null: migration 0034 ainda não aplicada). */
  quality: QualitySnapshot | null;
  /** Cota do YouTube do Conteúdo relacionado (null: migration 0039 ainda não aplicada). */
  youtube: YoutubeSnapshot | null;
}

// ── Qualidade dos dados (job data-quality, ops.quality_*) ────────────────────────────────────────

export type QualitySeverity = 'critical' | 'high' | 'medium' | 'low';
export type QualityStatus = 'pass' | 'fail' | 'skipped' | 'error';

export interface QualityRuleInfo {
  id: string;
  sport: string;
  area: string;
  severity: QualitySeverity;
  /** Por idioma (pt-BR, en, es). */
  description: Record<string, string>;
  origin: string | null;
}

/** Último resultado de uma regra num esporte, com a série das execuções anteriores (mais antiga → mais nova). */
export interface QualityResultRow {
  ruleId: string;
  sport: string;
  severity: QualitySeverity;
  status: QualityStatus;
  checked: number;
  failed: number;
  detail: string | null;
  runAt: string;
  /** Errados nas últimas execuções (a última é esta). */
  trend: number[];
}

export interface QualityLink {
  type: string;
  id: string;
  kind?: string | null;
  name?: string | null;
}

export interface QualityFailureRow {
  ruleId: string;
  sport: string;
  label: string;
  current: string | null;
  expected: string | null;
  link: QualityLink | null;
  firstSeenAt: string;
}

export interface QualitySnapshot {
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    trigger: string;
    rules: number;
    failed: number;
  } | null;
  rules: QualityRuleInfo[];
  results: QualityResultRow[];
  failures: QualityFailureRow[];
  /** Falhas guardadas além das que vieram (o painel mostra as primeiras). */
  failuresTotal: number;
}
