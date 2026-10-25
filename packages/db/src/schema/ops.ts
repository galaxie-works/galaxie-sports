import {
  bigint,
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

/**
 * Resposta do raw que a normalização (`normalize:<esporte>`) não conseguiu levar ao core. Cada execução que
 * falha nela soma uma tentativa e segura o cursor incremental; depois de algumas tentativas ela vira poison
 * (`poisoned_at`) e o cursor segue sem ela. O incremental tenta a poison de novo uma vez por dia e
 * `--reprocessar-falhas` tenta as pendentes na hora; quando passa (ou a requisição já tem resposta mais nova no
 * raw), `resolved_at`, e uma falha nova depois disso recomeça a contagem. Sem FK: a retenção do raw pode apagar
 * a linha.
 */
export const normalizeFailure = ops.table(
  'normalize_failure',
  {
    provider: text('provider').notNull(),
    sport: text('sport').notNull(),
    rawId: bigint('raw_id', { mode: 'number' }).notNull(),
    endpoint: text('endpoint').notNull(),
    attempts: integer('attempts').notNull().default(1),
    /** Erro da última tentativa. */
    error: text('error'),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true }).notNull().defaultNow(),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).notNull().defaultNow(),
    poisonedAt: timestamp('poisoned_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.provider, t.sport, t.rawId] })],
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
 * (AI_DAILY_TOKEN_BUDGET) e em US$ (AI_DAILY_USD_BUDGET e AI_AGENT_USD_BUDGETS, pelo `cost_usd`, que soma
 * tokens e buscas na web) compartilhado por todos os agentes (services/ai-agents/src/llm/budget.ts).
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

// ─── qualidade dos dados (job `data-quality`, services/ingestor/src/quality) ───────────────────────

/** Severidade de uma regra de qualidade: critical = erro que o cliente vê na página; low = cosmético. */
export const QUALITY_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

/** pass = nada errado · fail = ao menos um item errado · skipped = faltou a fonte (motivo em `detail`) · error = a consulta falhou. */
export const QUALITY_STATUSES = ['pass', 'fail', 'skipped', 'error'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/** Link da falha para a página ou o item (a demo monta a URL). */
export type QualityLink = {
  /** participant | event | person | competition | platform | plan | country */
  type: string;
  id: string;
  /** Rótulo da URL do participante (piloto e lutador têm rota própria). */
  kind?: string | null;
  name?: string | null;
};

/** Catálogo das regras, regravado a cada execução a partir do código (o painel lê daqui a descrição). */
export const qualityRule = ops.table('quality_rule', {
  id: text('id').primaryKey(),
  /** Esporte da regra (slug) ou `*` quando vale para todos (o resultado sai por esporte). */
  sport: text('sport').notNull(),
  /** f1 | events | standings | assets | people | wikidata | watch | geo */
  area: text('area').notNull(),
  severity: text('severity').$type<QualitySeverity>().notNull(),
  /** Descrição por idioma (pt-BR, en, es). */
  description: jsonb('description').$type<Record<string, string>>().notNull(),
  /** De onde veio a regra (ex.: "erro achado pelo dono do produto em 24/10/2026"). */
  origin: text('origin'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Uma execução do motor de regras (job diário ou `quality:run` sem `--plan`). */
export const qualityRun = ops.table(
  'quality_run',
  {
    id: pkUuidV7(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** schedule | cli */
    trigger: text('trigger').notNull(),
    /** running | done | error */
    status: text('status').notNull().default('running'),
    rules: integer('rules').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('quality_run_started_idx').on(t.startedAt)],
);

/** Resultado de uma regra num esporte, numa execução: base do placar e da tendência. */
export const qualityResult = ops.table(
  'quality_result',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => qualityRun.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    sport: text('sport').notNull(),
    severity: text('severity').$type<QualitySeverity>().notNull(),
    status: text('status').$type<QualityStatus>().notNull(),
    /** Itens conferidos e itens errados. */
    checked: integer('checked').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** Motivo do skipped ou mensagem do error. */
    detail: text('detail'),
    durationMs: integer('duration_ms').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.ruleId, t.sport] }),
    index('quality_result_rule_idx').on(t.ruleId, t.sport),
  ],
);

/** Item errado de uma regra numa execução (só as execuções recentes ficam: a retenção apaga as velhas). */
export const qualityFailure = ops.table(
  'quality_failure',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => qualityRun.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    sport: text('sport').notNull(),
    /** Chave estável do item na regra (ex.: `<participant>:1955`): liga a mesma falha entre execuções. */
    itemKey: text('item_key').notNull(),
    label: text('label').notNull(),
    current: text('current'),
    expected: text('expected'),
    link: jsonb('link').$type<QualityLink>(),
    /** Primeira execução em que a falha apareceu (seguida, sem sumir no meio). */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quality_failure_run_idx').on(t.runId, t.ruleId, t.sport)],
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
