import { index, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkUuidV7 } from './_shared.js';
import { event } from './core.js';

export const enrich = pgSchema('enrich');

export const broadcastMedium = enrich.enum('broadcast_medium', [
  'free_tv',
  'pay_tv',
  'streaming_svod',
  'streaming_free',
  'youtube',
  'official_app',
  'radio',
]);
export const accessModel = enrich.enum('access_model', ['free', 'subscription', 'ppv', 'unknown']);
export const broadcastStatus = enrich.enum('broadcast_status', [
  'confirmed',
  'probable',
  'pending',
  'omitted',
  'retracted',
]);

export type Evidence = { url: string; excerpt: string; publisher?: string; fetchedAt: string };

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
    channelName: text('channel_name'),
    medium: broadcastMedium('medium').notNull(),
    accessModel: accessModel('access_model').notNull(),
    url: text('url'),
    language: text('language'),
    status: broadcastStatus('status').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    evidence: jsonb('evidence').$type<Evidence[]>().notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
    /** agent:wtw@v1 | editorial:<usuario> | provider:sportmonks */
    producedBy: text('produced_by').notNull(),
    supersededBy: uuid('superseded_by'),
  },
  (t) => [index('broadcast_option_event_country_idx').on(t.eventId, t.countryCode, t.status)],
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
