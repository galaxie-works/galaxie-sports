import {
  date,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, i18n, pkUuidV7, REVIEW_STATUSES, updatedAt } from './_shared.js';
import { competition, participant } from './core.js';

export const semantic = pgSchema('semantic');

export const reviewStatus = semantic.enum('review_status', REVIEW_STATUSES);

/** Perfil semântico de time/seleção carregado de data/knowledge/football/teams/*.yaml. */
export const teamProfile = semantic.table(
  'team_profile',
  {
    slug: text('slug').primaryKey(),
    /** Preenchido após resolução de IDs (provider_map); null enquanto não resolvido. */
    participantId: uuid('participant_id').references(() => participant.id),
    countryCode: text('country_code').notNull(),
    names: jsonb('names').notNull(),
    labels: i18n('labels'),
    nicknames: jsonb('nicknames').$type<string[]>().notNull().default([]),
    fans: jsonb('fans'),
    mascot: text('mascot'),
    rallyingCries: jsonb('rallying_cries').$type<string[]>().notNull().default([]),
    stadium: jsonb('stadium'),
    identity: jsonb('identity').$type<string[]>().notNull().default([]),
    copyHints: jsonb('copy_hints'),
    /** Arquivo e versão de origem no repositório. */
    sourceFile: text('source_file').notNull(),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    updatedAt: updatedAt(),
  },
  (t) => [index('team_profile_participant_idx').on(t.participantId)],
);

export const derby = semantic.table('derby', {
  id: pkUuidV7(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  labels: i18n('labels'),
  /** city | state | national | continental | international */
  scope: text('scope').notNull(),
  intensity: smallint('intensity').notNull(),
  firstMatch: date('first_match'),
  origin: text('origin'),
  trivia: jsonb('trivia').$type<string[]>().notNull().default([]),
  sourceFile: text('source_file').notNull(),
  sources: jsonb('sources').$type<string[]>().notNull().default([]),
  reviewStatus: reviewStatus('review_status').notNull().default('draft'),
  updatedAt: updatedAt(),
});

export const derbyTeam = semantic.table(
  'derby_team',
  {
    derbyId: uuid('derby_id')
      .notNull()
      .references(() => derby.id, { onDelete: 'cascade' }),
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teamProfile.slug),
  },
  (t) => [primaryKey({ columns: [t.derbyId, t.teamSlug] }), index('derby_team_slug_idx').on(t.teamSlug)],
);

export const competitionProfile = semantic.table('competition_profile', {
  slug: text('slug').primaryKey(),
  competitionId: uuid('competition_id').references(() => competition.id),
  labels: i18n('labels'),
  nicknames: jsonb('nicknames'),
  trophyNickname: text('trophy_nickname'),
  sourceFile: text('source_file').notNull(),
  sources: jsonb('sources').$type<string[]>().notNull().default([]),
  reviewStatus: reviewStatus('review_status').notNull().default('draft'),
  updatedAt: updatedAt(),
});

/** Microcopy por locale × esporte × intenção × intensidade (docs/06 §4). */
export const copyTemplate = semantic.table(
  'copy_template',
  {
    id: pkUuidV7(),
    locale: text('locale').notNull(),
    sport: text('sport').notNull(),
    copyIntent: text('copy_intent').notNull(),
    toneIntensity: smallint('tone_intensity').notNull(),
    affinityType: text('affinity_type'),
    affinitySource: text('affinity_source'),
    momentum: text('momentum'),
    competitionContext: text('competition_context'),
    /** HIGH | MEDIUM | EXPERIMENTAL */
    confidence: text('confidence').notNull(),
    template: text('template').notNull(),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    createdAt: createdAt(),
  },
  (t) => [index('copy_template_lookup_idx').on(t.locale, t.sport, t.copyIntent)],
);

export const loadRun = semantic.table('load_run', {
  id: pkUuidV7(),
  gitSha: text('git_sha'),
  teams: smallint('teams').notNull(),
  derbies: smallint('derbies').notNull(),
  competitions: smallint('competitions').notNull(),
  loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
});
