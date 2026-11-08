/**
 * Dados do painel de Operação (Ajustes → Operação), já serializáveis: o servidor monta, o navegador só
 * desenha. Segredos chegam só como `configured`; nenhum valor de credencial sai do servidor.
 */
import type { MirrorInventory, RuntimeService, SettingSource, SettingSection } from '@galaxie/runtime-config';

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
  /** Só no `live`: quem é a líder e o último tick. */
  live?: LiveServiceStatus;
}

/** O serviço do ao vivo (#535): a líder (época da liderança) e o último tick, lidos de `ops.sync_cursor`. */
export interface LiveServiceStatus {
  /** Cópia (ID do contêiner) que abriu o mandato atual; `null` = nenhuma assumiu ainda. */
  leader: string | null;
  epoch: number | null;
  leaderSince: string | null;
  /** Último tick de qualquer cópia (registro do ritmo, #538); `null` sem registro. */
  lastTickAt: string | null;
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
  service: 'ingestor' | 'agents' | 'live';
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
  /** Dia de orçamento lido (YYYY-MM-DD): vira em `day.start` no fuso `day.timeZone`. */
  budgetDay: string;
  day: { timeZone: string; start: string };
  /** AI_BAND_SHARES efetivo: % do teto global por faixa (soma 100; a reserva só serve a P0). */
  bandShares: Record<'p0' | 'reserve' | 'p1' | 'clients' | 'rest' | 'manual', number>;
  /** Gasto do dia por faixa, contra o teto dela (a P0 inclui a reserva); null = sem teto. */
  bands: { band: 'p0' | 'p1' | 'clients' | 'rest' | 'manual'; usedUsd: number; limitUsd: number | null }[];
  /** AI_P0_MIN_AUDIENCE: corte P0/P1 (audiência mínima). */
  p0MinAudience: number;
  /** Alguma das chaves do cartão Política de IA tem sobrescrita no painel (o "voltar ao padrão" a apaga). */
  policyOverridden: boolean;
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
  /** Fila de tarefas (null: colunas da fila ainda não migradas). */
  tasks: OpsTasks | null;
  /** Espelho da api-sports (sync:mirror): cota de cada API e o inventário da última execução. */
  mirror: MirrorSnapshot;
}

/** Uma API no espelho: plano efetivo, cota do dia e o inventário gravado pelo job (base da estimativa). */
export interface MirrorApiView {
  api: string;
  plan: string | null;
  /** Cota diária do plano (null: plano desconhecido). */
  dailyLimit: number | null;
  /** Inventário da última execução (ou do `--plan`); null = o job ainda não rodou com o inventário. */
  inventory: MirrorInventory | null;
  /** Inventário descartado por ser de outro plano (a contagem depende do plano): o plano dele. */
  inventoryOtherPlan: string | null;
}

export interface MirrorSnapshot {
  /** APP_ENV production/staging: a reserva do ao vivo vale só para os outros jobs. No dev ela é de pelo menos 70%. */
  production: boolean;
  /** Reserva efetiva da cota (%): QUOTA_LIVE_RESERVE_PERCENT, no dev no mínimo 70. */
  reservePercent: number;
  apis: MirrorApiView[];
}

// ── Tarefas da fila (ops.job_request com `type`, @galaxie/db/queue-admin) ─────────────────────────

export type TaskStateView =
  'pendente' | 'retomada' | 'rodando' | 'concluida' | 'falha' | 'cancelada' | 'outro';

export interface TaskProgressView {
  feitos: number;
  total: number | null;
  lote: string | null;
}

export interface TaskPreviewView {
  resumo: string | null;
  contagens: Record<string, number>;
  amostra: unknown[];
}

/** Linha da lista de tarefas (datas em ISO). */
export interface TaskListItem {
  id: string;
  type: string;
  status: string;
  state: TaskStateView;
  /** É a prévia (`params.previa`). */
  previa: boolean;
  /** Prévia concluída com plano, sem aprovação ainda. */
  awaitingApproval: boolean;
  /** Execução aprovada desta prévia. */
  previaId: string | null;
  reprocessaDe: string | null;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedUntil: string | null;
  requestedBy: string;
  requestedAt: string;
  finishedAt: string | null;
  progress: TaskProgressView | null;
  detail: string | null;
  lastError: string | null;
}

export interface TaskRunView {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  resumed: boolean;
  worker: string | null;
}

export interface TaskLinkView {
  id: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
}

export interface TaskDetailView extends TaskListItem {
  /** O tipo apaga, troca ou religa dados (reprocessar a execução volta como prévia). */
  destrutiva: boolean;
  /** Params do tipo, sem as chaves reservadas. */
  params: Record<string, unknown>;
  checkpoint: unknown;
  preview: TaskPreviewView | null;
  log: string[];
  runs: TaskRunView[];
  approvals: TaskLinkView[];
  reprocesses: TaskLinkView[];
}

export interface TaskParamFieldView {
  name: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'json';
  required: boolean;
  description: string | null;
  options: string[] | null;
  default: unknown;
}

export interface TaskTypeView {
  type: string;
  descricao: string;
  previa: boolean;
  destrutiva: boolean;
  fields: TaskParamFieldView[];
}

export interface OpsTasks {
  items: TaskListItem[];
  types: TaskTypeView[];
  /** Estado dos workers da fila, lido das concessões (sem chamar o worker por HTTP). */
  workers: WorkerView[];
}

/**
 * `busy`: tem tarefa com a concessão em dia; `expired`: a concessão de uma tarefa dele venceu (parou de renovar: caiu
 * ou travou; outro worker retoma); `idle`: tomou tarefa nas últimas 24 h e não tem nenhuma agora.
 */
export type WorkerStateView = 'busy' | 'idle' | 'expired';

export interface WorkerTaskView {
  id: string;
  type: string;
  attempts: number;
  /** Lote atual (`checkpoint.progresso.lote`) e contagem, quando o executor grava. */
  batch: string | null;
  done: number | null;
  total: number | null;
  pickedAt: string | null;
  /** Fim da concessão; a última renovação foi 90 s antes. */
  lockedUntil: string | null;
  lastRenewAt: string | null;
}

export interface WorkerView {
  /** `<hostname>:<pid>` (o contêiner) ou WORKER_ID. */
  id: string;
  state: WorkerStateView;
  tasks: WorkerTaskView[];
  /** Fim da última tomada encerrada (o worker ocioso). */
  lastSeenAt: string | null;
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
