import {
  bigserial,
  index,
  integer,
  jsonb,
  pgSchema,
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
