import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { pkUuidV7 } from './_shared.js';

export const ops = pgSchema('ops');

export const QUOTA_PRIORITIES = ['BOOTSTRAP', 'DAILY', 'LIVE', 'ADHOC'] as const;
export const quotaPriority = ops.enum('quota_priority', QUOTA_PRIORITIES);

/** Uma linha por chamada enviada a um provedor — fonte da verdade da cota (os contadores do fornecedor são eventualmente consistentes). */
export const quotaLedger = ops.table(
  'quota_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull().default('api-sports'),
    /** football, basketball... — cada API tem cota própria. */
    api: text('api').notNull(),
    /** Dia de cota no fuso do fornecedor (00:00 UTC na api-sports). */
    dayUtc: date('day_utc').notNull(),
    priority: quotaPriority('priority').notNull(),
    endpoint: text('endpoint').notNull(),
    requestHash: text('request_hash').notNull(),
    /** pending (reservada, ainda não enviada) | ok | plan_error | rate_limited | quota_exhausted | auth_error | http_error | timeout */
    outcome: text('outcome').notNull(),
    remainingAfter: integer('remaining_after'),
    jobId: text('job_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quota_ledger_day_idx').on(t.provider, t.api, t.dayUtc)],
);

/** Contador do fornecedor lido via /status (gratuito) — usado como piso na reconciliação, pois é eventualmente consistente. */
export const quotaSnapshot = ops.table(
  'quota_snapshot',
  {
    provider: text('provider').notNull().default('api-sports'),
    api: text('api').notNull(),
    dayUtc: date('day_utc').notNull(),
    providerUsed: integer('provider_used').notNull(),
    providerLimit: integer('provider_limit').notNull(),
    plan: text('plan'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.api, t.dayUtc] })],
);

export const quotaBudget = ops.table(
  'quota_budget',
  {
    provider: text('provider').notNull().default('api-sports'),
    api: text('api').notNull(),
    dayUtc: date('day_utc').notNull(),
    priority: quotaPriority('priority').notNull(),
    planned: integer('planned').notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.api, t.dayUtc, t.priority] })],
);

/** Marca d'água por (provedor, esporte, endpoint, chave) — ex.: fixtures?league=71&season=2024 concluído. */
export const syncCursor = ops.table(
  'sync_cursor',
  {
    provider: text('provider').notNull().default('api-sports'),
    sport: text('sport').notNull(),
    endpoint: text('endpoint').notNull(),
    key: text('key').notNull(),
    cursor: jsonb('cursor'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.sport, t.endpoint, t.key] })],
);

export const jobRun = ops.table(
  'job_run',
  {
    id: pkUuidV7(),
    job: text('job').notNull(),
    status: text('status').notNull(),
    callsSpent: integer('calls_spent').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    stats: jsonb('stats'),
  },
  (t) => [index('job_run_job_started_idx').on(t.job, t.startedAt)],
);

/**
 * Ledger de uso de LLM (uma linha por chamada) — fonte da verdade do orçamento diário de tokens
 * (AI_DAILY_TOKEN_BUDGET) compartilhado por todos os agentes (services/ai-agents/src/llm/budget.ts).
 */
export const llmUsage = ops.table(
  'llm_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Dia do orçamento (UTC). */
    dayUtc: date('day_utc').notNull(),
    /** Agente (prefixo de `purpose`, ex.: wtw, live, context). */
    agent: text('agent').notNull(),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tier: text('tier').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    webSearches: integer('web_searches').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    /** ok | error */
    outcome: text('outcome').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_usage_day_agent_idx').on(t.dayUtc, t.agent)],
);

/** Mudanças publicadas — alimenta SSE, webhooks e purge de CDN. */
export const changeFeed = ops.table(
  'change_feed',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    topic: text('topic').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('change_feed_created_idx').on(t.createdAt)],
);

/**
 * Configuração da operação em tempo de execução (painel Ajustes → Operação). Precedência: esta tabela >
 * env do contêiner > padrão do código (`@galaxie/runtime-config`). Valores sempre em texto, já
 * validados pelo tipo da flag; segredos nunca entram aqui.
 */
export const runtimeSetting = ops.table('runtime_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  /** Tipo da flag no registro quando foi gravada (cron, enum, int, number, markets, text). */
  valueType: text('value_type').notNull(),
  /** Quem mudou (e-mail do admin da demo). */
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Histórico das mudanças do painel: uma linha por gravação ou volta ao padrão. */
export const runtimeSettingLog = ops.table(
  'runtime_setting_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key').notNull(),
    /** set (gravou) | reset (voltou ao padrão: apagou a sobrescrita). */
    action: text('action').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedBy: text('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('runtime_setting_log_changed_idx').on(t.changedAt),
    index('runtime_setting_log_key_idx').on(t.key, t.changedAt),
  ],
);

/**
 * O que cada contêiner tem no próprio env para as flags do registro (o painel roda em outro contêiner
 * e não enxerga esse env). Segredos só como `configured`; `value` fica nulo. `reported_at` é atualizado
 * a cada releitura do scheduler e serve de sinal de vida.
 */
export const runtimeEnv = ops.table(
  'runtime_env',
  {
    service: text('service').notNull(),
    key: text('key').notNull(),
    value: text('value'),
    configured: boolean('configured').notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.service, t.key] })],
);

/** Pedidos de "rodar agora" do painel; o scheduler do perfil do job pega, executa e fecha. */
export const jobRequest = ops.table(
  'job_request',
  {
    id: pkUuidV7(),
    job: text('job').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** pending | running | done | error | skipped | expired */
    status: text('status').notNull().default('pending'),
    pickedAt: timestamp('picked_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** ops.job_run.id da execução (quando houve). */
    runId: uuid('run_id'),
    detail: text('detail'),
  },
  (t) => [index('job_request_status_idx').on(t.status, t.requestedAt)],
);

/** Resultado das checagens feitas por um serviço (ex.: crédito da conta de IA, pelo scheduler dos agentes). */
export const runtimeCheck = ops.table(
  'runtime_check',
  {
    service: text('service').notNull(),
    name: text('name').notNull(),
    /** pass | warn | fail */
    status: text('status').notNull(),
    detail: text('detail'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.service, t.name] })],
);
