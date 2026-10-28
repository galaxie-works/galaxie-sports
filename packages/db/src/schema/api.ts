import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { platform } from './lineups.js';

/** Schema da API pública: tenants, chaves de acesso e fila de backfill do espelho (docs/05 §1–2). */
export const api = pgSchema('api');

/** Módulos vendáveis (docs/01 §pacotes). Cada rota da API exige um módulo. */
export const API_MODULES = [
  'core_data',
  'where_to_watch',
  'semantic',
  'live_intelligence',
  'multisport',
  /** Add-on: vídeos relacionados por evento (docs/12). */
  'related_content',
] as const;
export type ApiModule = (typeof API_MODULES)[number];

export const API_PLANS = ['trial', 'core_data', 'fan_experience', 'live_intelligence', 'enterprise'] as const;
export type ApiPlan = (typeof API_PLANS)[number];

/** Planos sem tempo real: nem SSE (`/v1/stream`) nem webhooks (docs/politica-de-chaves.md §3). */
export const PLANS_WITHOUT_REALTIME: readonly ApiPlan[] = ['trial'];

/** Módulos incluídos por padrão em cada plano (o tenant pode ter uma lista personalizada). */
export const PLAN_MODULES: Record<ApiPlan, readonly ApiModule[]> = {
  trial: ['core_data'],
  core_data: ['core_data'],
  fan_experience: ['core_data', 'where_to_watch', 'semantic'],
  live_intelligence: ['core_data', 'where_to_watch', 'semantic', 'live_intelligence', 'multisport'],
  enterprise: API_MODULES,
};

export const tenantStatus = api.enum('tenant_status', ['active', 'suspended']);

/** Cliente da API: plano, módulos, mercados (países) e esportes contratados. */
export const tenant = api.table('tenant', {
  id: pkUuidV7(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  plan: text('plan').$type<ApiPlan>().notNull(),
  modules: text('modules').array().$type<ApiModule[]>().notNull(),
  /** Países (ISO2) contratados; lista vazia = todos os mercados. */
  markets: text('markets').array().notNull().default([]),
  /** Esportes contratados (slug); lista vazia = todos. */
  sports: text('sports').array().notNull().default([]),
  /** Requisições por minuto, por rota. */
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(120),
  /**
   * Cota diária de requisições de produção (todas as rotas; a chave de teste fica fora); null = sem cota.
   * Aviso a partir de 80% e 429 QUOTA_EXCEEDED a partir de 110%, até a virada do dia UTC.
   */
  dailyRequestQuota: integer('daily_request_quota'),
  /** Fim do trial (plano `trial`): depois dele nenhuma chave do tenant autentica. null = sem prazo. */
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  status: tenantStatus('status').notNull().default('active'),
  /** Plataforma (enrich.platform) quando o cliente é uma operadora/streaming da grade. */
  operatorPlatformId: uuid('operator_platform_id').references((): AnyPgColumn => platform.id, {
    onDelete: 'set null',
  }),
  /** No onde assistir do cliente operadora, mostra também as outras plataformas (padrão: só a dele). */
  showOtherOperators: boolean('show_other_operators').notNull().default(false),
  /** Domínios de e-mail da operadora (sem @), para ligar usuários do portal ao tenant. */
  operatorEmailDomains: text('operator_email_domains')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Chave de acesso (`gs_live_<prefixo>_<segredo>`). Só o prefixo fica em claro (busca);
 * o segredo é guardado como hash scrypt com sal. A chave completa é exibida uma única vez.
 */
export const apiKey = api.table(
  'api_key',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    /** Ambiente do prefixo da chave (`gs_live_` / `gs_test_`). */
    env: text('env').$type<'live' | 'test'>().notNull().default('live'),
    /** scrypt$N$r$p$sal$hash (base64url). */
    secretHash: text('secret_hash').notNull(),
    label: text('label'),
    /** Restringe os módulos do tenant para esta chave; null = herda todos os módulos do tenant. */
    scopes: text('scopes').array().$type<ApiModule[]>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Quando a chave foi substituída por uma rotação (fica válida só no período de graça). Uma chave
     * já rotacionada não pode ser rotacionada de novo: quem tem só a chave antiga não gera outra.
     */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /**
     * Formato da chave: 1 = legado (`gs_<env>_<prefixo>_<segredo>`, ambiente das chaves anteriores à 0007
     * desconhecido); 2 = com checksum (`..._<crc32>`, docs/politica-de-chaves.md). As de formato 1 são
     * revogadas e reemitidas por `pnpm --filter @galaxie/api keys:migrate` (docs/runbooks/migracao-de-chaves.md).
     */
    keyFormat: integer('key_format').notNull().default(1),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_key_prefix_uq').on(t.prefix), index('api_key_tenant_idx').on(t.tenantId)],
);

/**
 * Auditoria das chaves (secretas e publicáveis): emissão, rotação, revogação e migração, com quem fez e
 * quando. Nunca guarda o segredo, só o prefixo (docs/politica-de-chaves.md §5).
 */
export const apiKeyEvent = api.table(
  'api_key_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** `secret` (api.api_key) ou `publishable` (ops.publishable_key). */
    keyKind: text('key_kind').$type<'secret' | 'publishable'>().notNull(),
    keyId: uuid('key_id').notNull(),
    prefix: text('prefix').notNull(),
    /** issued | rotated | revoked | migrated */
    action: text('action').$type<'issued' | 'rotated' | 'revoked' | 'migrated'>().notNull(),
    /** Quem fez: `admin`, `tenant` (autoatendimento), `cli:<comando>`, `panel:<id do usuário>`, `widget`. */
    actor: text('actor').notNull(),
    /** Contexto (ex.: chave nova da rotação, período de graça). Nunca segredos. */
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('api_key_event_tenant_idx').on(t.tenantId, t.createdAt)],
);

/**
 * Uso diário por tenant × rota (padrão da rota, ex.: `GET /v1/competitions/:id`). Os contadores
 * vivem no Valkey (HINCRBY em chaves diárias) e são consolidados aqui periodicamente; `requests`
 * é o total acumulado do dia (o flush é idempotente).
 */
export const usageDaily = api.table(
  'usage_daily',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Dia em UTC. */
    day: date('day', { mode: 'string' }).notNull(),
    route: text('route').notNull(),
    requests: bigint('requests', { mode: 'number' }).notNull().default(0),
    /**
     * Época do hash do Valkey que alimentou a última consolidação (`#epoca`) e `epoch_base`, o consolidado
     * das épocas anteriores. Mesma época: `requests = greatest(requests, base + contador)`; época nova
     * (Valkey zerado): `base := requests` e soma. Só `greatest()`, então uma versão anterior da API que
     * consolide junto (rollout, rollback) não faz o total crescer em dobro. null = linha anterior às épocas.
     */
    epoch: text('epoch'),
    epochBase: bigint('epoch_base', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day, t.route] }), index('usage_daily_day_idx').on(t.day)],
);

/**
 * Combinações pedidas ao espelho que não existem no raw. O espelho nunca chama o fornecedor
 * em tempo real: a combinação entra aqui e o Quota Governor a busca com prioridade ADHOC.
 */
export const backfillRequest = api.table(
  'backfill_request',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull().default('api-sports'),
    sport: text('sport').notNull(),
    endpoint: text('endpoint').notNull(),
    params: jsonb('params').$type<Record<string, string>>().notNull(),
    requestHash: text('request_hash').notNull(),
    priority: text('priority').notNull().default('ADHOC'),
    /** pending | done | failed | skipped */
    status: text('status').notNull().default('pending'),
    /** Quantas vezes a combinação foi pedida (ajuda a priorizar). */
    hits: integer('hits').notNull().default(1),
    tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'set null' }),
    firstRequestedAt: timestamp('first_requested_at', { withTimezone: true }).notNull().defaultNow(),
    lastRequestedAt: timestamp('last_requested_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('backfill_request_hash_uq').on(t.requestHash),
    index('backfill_request_status_idx').on(t.status, t.lastRequestedAt),
  ],
);

// ─── tempo real: webhooks (docs/05 §5) ───────────────────────────────────────────────────────────

/** Tópicos públicos entregues por SSE e webhooks (gerados pelos triggers de captura e por publishChange). */
export const REALTIME_TOPICS = [
  'event.status_changed',
  'event.score_changed',
  'event.incident_added',
  'where_to_watch.changed',
  'event.context_published',
  'event.related_content_changed',
] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

/** Filtros opcionais de um webhook; ausente/vazio = sem restrição. */
export type WebhookFilters = { events?: string[]; competitions?: string[]; sports?: string[] };

/**
 * Destino de webhooks de um tenant. O segredo assina o corpo (HMAC-SHA256) e é exibido uma única
 * vez, na criação; fica em claro no banco porque o worker precisa dele para assinar.
 */
export const webhookEndpoint = api.table(
  'webhook_endpoint',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    /** Tópicos assinados; lista vazia = todos os tópicos permitidos pelo plano. */
    topics: text('topics').array().$type<RealtimeTopic[]>().notNull().default([]),
    filters: jsonb('filters').$type<WebhookFilters>().notNull().default({}),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('webhook_endpoint_tenant_idx').on(t.tenantId, t.active)],
);

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'dead'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * Uma entrega = uma mudança (`ops.change_feed`) para um endpoint, única por (endpoint, mudança):
 * o enfileiramento é idempotente. Após N falhas a entrega vai para `dead` (DLQ).
 */
export const webhookDelivery = api.table(
  'webhook_delivery',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: 'cascade' }),
    changeId: bigint('change_id', { mode: 'number' }).notNull(),
    topic: text('topic').notNull(),
    /** Corpo enviado, congelado no enfileiramento: retries reenviam exatamente o mesmo JSON. */
    payload: jsonb('payload').notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    responseCode: integer('response_code'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webhook_delivery_endpoint_change_uq').on(t.endpointId, t.changeId),
    index('webhook_delivery_due_idx').on(t.status, t.nextRetryAt),
  ],
);

/** Marca d'água do enfileirador de webhooks sobre `ops.change_feed` (uma linha por consumidor). */
export const webhookCursor = api.table('webhook_cursor', {
  name: text('name').primaryKey(),
  lastChangeId: bigint('last_change_id', { mode: 'number' }).notNull().default(0),
  updatedAt: updatedAt(),
});
