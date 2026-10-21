import { sql } from 'drizzle-orm';
import {
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pkUuidV7 } from './_shared.js';
import { event } from './core.js';

export const enrich = pgSchema('enrich');

export const BROADCAST_MEDIA = [
  'free_tv',
  'pay_tv',
  'streaming_svod',
  'streaming_free',
  'youtube',
  'official_app',
  'radio',
] as const;
export type BroadcastMedium = (typeof BROADCAST_MEDIA)[number];
export const broadcastMedium = enrich.enum('broadcast_medium', BROADCAST_MEDIA);

export const ACCESS_MODELS = ['free', 'subscription', 'ppv', 'unknown'] as const;
export type AccessModel = (typeof ACCESS_MODELS)[number];
export const accessModel = enrich.enum('access_model', ACCESS_MODELS);

/**
 * confirmed = publicada (confiança ≥ limiar) · probable = reservado · pending = guardada, não aparece ·
 * omitted = conflito entre fontes (não aparece) · retracted = removida (lápide da versão anterior).
 */
export const BROADCAST_STATUSES = ['confirmed', 'probable', 'pending', 'omitted', 'retracted'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];
export const broadcastStatus = enrich.enum('broadcast_status', BROADCAST_STATUSES);

/** Tipo da fonte de uma evidência, classificado pelo domínio (código, nunca pelo LLM). */
export const SOURCE_KINDS = [
  'broadcaster',
  'organizer',
  'press',
  'aggregator',
  'unknown',
  'editorial',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type Evidence = {
  url: string;
  /** Trecho curto (≤ 200 caracteres) — nunca reproduzir a matéria. */
  excerpt: string;
  publisher?: string;
  fetchedAt: string;
  sourceKind?: SourceKind;
  /** Data de publicação da fonte, quando conhecida (penalidade de fonte velha). */
  publishedAt?: string | null;
  /** sha256 do texto normalizado da página na última verificação (revalidação por diff). */
  contentHash?: string | null;
  /** A fonte confirma ou nega a transmissão. */
  stance?: 'confirms' | 'denies';
};

/** Onde assistir: uma opção de transmissão por evento × país (docs/05 §4, docs/07 §2.2). */
export const broadcastOption = enrich.table(
  'broadcast_option',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
    /** UF/praça quando a transmissão é regional (ex.: SP, RJ); null = nacional. */
    region: text('region'),
    providerName: text('provider_name').notNull(),
    /** Id canônico do dicionário (config/broadcasters/<iso2>.yaml); null = nome desconhecido (vai para revisão). */
    broadcasterId: text('broadcaster_id'),
    channelName: text('channel_name'),
    medium: broadcastMedium('medium').notNull(),
    accessModel: accessModel('access_model').notNull(),
    url: text('url'),
    language: text('language'),
    status: broadcastStatus('status').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evidence: jsonb('evidence').$type<Evidence[]>().notNull(),
    /** Melhor tipo de fonte entre as evidências. */
    sourceKind: text('source_kind').$type<SourceKind>(),
    /** Fontes primárias divergem (a opção fica `omitted`). */
    conflict: boolean('conflict').notNull().default(false),
    /** Motivos de revisão: unknown_broadcaster, rights_mismatch, stale_source... */
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
    /** agent:wtw@v1 | editorial:<usuario> | provider:sportmonks */
    producedBy: text('produced_by').notNull(),
    /** Execução do agente que produziu esta versão. */
    runId: uuid('run_id'),
    /** Criação desta versão (cada mudança material gera uma nova linha). */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededBy: uuid('superseded_by'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    index('broadcast_option_event_country_idx').on(t.eventId, t.countryCode, t.status),
    index('broadcast_option_current_idx')
      .on(t.eventId, t.countryCode)
      .where(sql`${t.supersededBy} is null`),
  ],
);

export const WTW_WINDOWS = ['T-7d', 'T-24h', 'T-3h', 'T-30min', 'manual'] as const;
export type WtwWindow = (typeof WTW_WINDOWS)[number];

/**
 * Execuções do agente Onde Assistir por (evento, país, janela). `run_key` garante idempotência:
 * a mesma janela de um mesmo jogo/país roda uma única vez (cache por evento × país × janela).
 */
export const wtwRun = enrich.table(
  'wtw_run',
  {
    id: pkUuidV7(),
    /** `<event>:<país>:<janela>`; execuções manuais levam o instante do pedido. */
    runKey: text('run_key').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
    window: text('window').$type<WtwWindow>().notNull(),
    /** full = busca completa · revalidate = refaz o fetch das URLs salvas e só busca se mudou. */
    mode: text('mode').$type<'full' | 'revalidate'>().notNull(),
    /** queued | running | done | failed | skipped */
    status: text('status').notNull().default('queued'),
    /** scheduler | editorial:<usuario> | cli */
    requestedBy: text('requested_by').notNull().default('scheduler'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    stats: jsonb('stats'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('wtw_run_key_uq').on(t.runKey),
    index('wtw_run_status_idx').on(t.status, t.scheduledFor),
    index('wtw_run_event_idx').on(t.eventId, t.countryCode),
  ],
);

/** Trilha de auditoria das correções editoriais (inclusão, correção, remoção, reexecução). */
export const broadcastCorrection = enrich.table(
  'broadcast_correction',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
    /** add | correct | remove | rerun */
    action: text('action').notNull(),
    /** Versão criada pela correção (null em rerun). */
    optionId: uuid('option_id'),
    /** Versão substituída (null em add sem versão anterior). */
    previousOptionId: uuid('previous_option_id'),
    /** Identificador da pessoa (handle interno; nunca e-mail). */
    actor: text('actor').notNull(),
    reason: text('reason').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    /** Quando o erro foi reportado (auditoria, usuário) — mede o tempo de correção. */
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    /** Entrada do ops.change_feed que propagou a correção. */
    changeId: integer('change_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('broadcast_correction_event_idx').on(t.eventId, t.countryCode, t.createdAt)],
);

/** Fila de auditoria amostral (docs/07 §4): opções publicadas conferidas por humanos. */
export const broadcastAudit = enrich.table(
  'broadcast_audit',
  {
    id: pkUuidV7(),
    optionId: uuid('option_id')
      .notNull()
      .references(() => broadcastOption.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
    sampleDate: date('sample_date').notNull(),
    /** daily_sample | low_confidence */
    reason: text('reason').notNull(),
    /** null = aguardando · correct | incorrect | unsure */
    verdict: text('verdict'),
    reviewer: text('reviewer'),
    note: text('note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('broadcast_audit_option_day_uq').on(t.optionId, t.sampleDate),
    index('broadcast_audit_pending_idx').on(t.verdict, t.sampleDate),
  ],
);

/** Cenário pré-jogo, resumo pós-jogo e fatos-chave gerados por IA a partir de fatos calculados. */
export const eventContext = enrich.table(
  'event_context',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    /** preview | scenario | recap | key_facts */
    kind: text('kind').notNull(),
    content: jsonb('content').notNull(),
    sources: jsonb('sources').notNull(),
    model: text('model').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    /** auto | reviewed | rejected */
    reviewStatus: text('review_status').notNull().default('auto'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.locale, t.kind, t.createdAt] })],
);
