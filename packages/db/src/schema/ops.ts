import {
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
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
    /** ok | plan_error | rate_limited | http_error | timeout */
    outcome: text('outcome').notNull(),
    remainingAfter: integer('remaining_after'),
    jobId: text('job_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quota_ledger_day_idx').on(t.provider, t.api, t.dayUtc)],
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
