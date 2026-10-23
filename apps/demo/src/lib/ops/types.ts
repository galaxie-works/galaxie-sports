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
}

export interface LlmSpend {
  totals: Omit<LlmAgentSpend, 'agent'>;
  byAgent: LlmAgentSpend[];
  /** Orçamento efetivo (tokens/dia); null = sem limite. */
  budget: number | null;
}

export interface CreditStatus {
  status: 'pass' | 'warn' | 'fail';
  /** ok | no_key | http | network */
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
}
