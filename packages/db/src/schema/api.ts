import {
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

/** Schema da API pública: tenants, chaves de acesso e fila de backfill do espelho (docs/05 §1–2). */
export const api = pgSchema('api');

/** Módulos vendáveis (docs/01 §pacotes). Cada rota da API exige um módulo. */
export const API_MODULES = [
  'core_data',
  'where_to_watch',
  'semantic',
  'live_intelligence',
  'multisport',
] as const;
export type ApiModule = (typeof API_MODULES)[number];

export const API_PLANS = ['core_data', 'fan_experience', 'live_intelligence', 'enterprise'] as const;
export type ApiPlan = (typeof API_PLANS)[number];

/** Módulos incluídos por padrão em cada plano (o tenant pode ter uma lista personalizada). */
export const PLAN_MODULES: Record<ApiPlan, readonly ApiModule[]> = {
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
  /** Cota diária de requisições (todas as rotas); null = sem cota. Informativa (exibida no uso). */
  dailyRequestQuota: integer('daily_request_quota'),
  status: tenantStatus('status').notNull().default('active'),
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
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_key_prefix_uq').on(t.prefix), index('api_key_tenant_idx').on(t.tenantId)],
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
