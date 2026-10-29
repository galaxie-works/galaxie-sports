import { sql } from 'drizzle-orm';
import { bigserial, index, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const raw = pgSchema('raw');

/**
 * Por quanto tempo uma resposta fica no raw (docs/04 §1.1, decisão de 28/10/2026):
 * - `keep`: diário, catálogo, temporada, detalhe — para sempre (é a fonte do reprocessamento);
 * - `live`: o que o ao vivo buscou (prioridade LIVE) — 30 dias; a última resposta de sucesso de cada
 *   requisição fica, para o reprocessamento e o espelho continuarem achando o estado final.
 */
export const RAW_RETENTION_CLASSES = ['keep', 'live'] as const;
export type RawRetentionClass = (typeof RAW_RETENTION_CLASSES)[number];

/**
 * Resposta integral de cada chamada a um provedor, gravada antes de qualquer transformação: permite
 * reprocessar o core e servir o espelho compatível sem gastar cota. Um corpo idêntico ao da última resposta
 * da mesma requisição não vira linha nova: a linha existente ganha `last_seen_at` e `seen_count`.
 */
export const apiResponse = raw.table(
  'api_response',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull().default('api-sports'),
    sport: text('sport').notNull(),
    apiVersion: text('api_version').notNull(),
    endpoint: text('endpoint').notNull(),
    /** Parâmetros normalizados (chaves ordenadas). */
    params: jsonb('params').$type<Record<string, string | number>>().notNull(),
    /** sha256(provider + sport + endpoint + params normalizados). */
    requestHash: text('request_hash').notNull(),
    page: integer('page').notNull().default(1),
    statusCode: integer('status_code').notNull(),
    results: integer('results'),
    errors: jsonb('errors'),
    /** Envelope completo {get, parameters, errors, results, paging, response}. */
    body: jsonb('body').notNull(),
    /** sha256 do body: a gravação compara com a última resposta da requisição e não duplica o corpo. */
    bodyHash: text('body_hash').notNull(),
    quotaRemaining: integer('quota_remaining'),
    /** Quando este corpo chegou pela primeira vez. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Última vez que o fornecedor devolveu este mesmo corpo (null = só em `fetched_at`). O frescor do cache
     * e do espelho conta por `coalesce(last_seen_at, fetched_at)`.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Quantas vezes o corpo chegou (1 = só a primeira). */
    seenCount: integer('seen_count').notNull().default(1),
    /** keep | live (RAW_RETENTION_CLASSES). */
    retention: text('retention').$type<RawRetentionClass>().notNull().default('keep'),
    jobId: text('job_id'),
  },
  (t) => [
    index('api_response_lookup_idx').on(t.provider, t.sport, t.endpoint, t.requestHash, t.fetchedAt.desc()),
    index('api_response_fetched_at_idx').on(t.fetchedAt),
    // frescor por esporte (métrica galaxie_raw_last_fetched_timestamp_seconds)
    index('api_response_seen_idx').on(t.sport, sql`coalesce(${t.lastSeenAt}, ${t.fetchedAt})`),
    // candidatas da retenção do ao vivo (raw-retention)
    index('api_response_live_seen_idx')
      .on(sql`coalesce(${t.lastSeenAt}, ${t.fetchedAt})`)
      .where(sql`${t.retention} = 'live'`),
  ],
);
