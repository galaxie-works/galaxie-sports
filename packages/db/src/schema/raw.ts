import { bigserial, index, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const raw = pgSchema('raw');

/**
 * Resposta integral de cada chamada a um provedor, gravada antes de qualquer transformação.
 * Imutável: permite reprocessar o core e servir o espelho compatível sem gastar cota.
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
    /** sha256 do body — permite deduplicar respostas idênticas consecutivas. */
    bodyHash: text('body_hash').notNull(),
    quotaRemaining: integer('quota_remaining'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    jobId: text('job_id'),
  },
  (t) => [
    index('api_response_lookup_idx').on(t.provider, t.sport, t.endpoint, t.requestHash, t.fetchedAt.desc()),
    index('api_response_fetched_at_idx').on(t.fetchedAt),
  ],
);
