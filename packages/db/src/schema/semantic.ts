import {
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, i18n, pkUuidV7, REVIEW_STATUSES, updatedAt } from './_shared.js';
import { competition, participant } from './core.js';

export const semantic = pgSchema('semantic');

export const reviewStatus = semantic.enum('review_status', REVIEW_STATUSES);

/** Rival declarado no YAML do time (slug do outro time, clássico e intensidade 1–5). */
export type TeamRival = { team: string; derby: string | null; intensity: number | null };

/** Perfil semântico de time/seleção carregado de data/knowledge/football/teams/*.yaml. */
export const teamProfile = semantic.table(
  'team_profile',
  {
    slug: text('slug').primaryKey(),
    /** Preenchido após resolução de IDs (provider_map); null enquanto não resolvido. */
    participantId: uuid('participant_id').references(() => participant.id),
    /** club | national_team */
    kind: text('kind').notNull().default('club'),
    countryCode: text('country_code').notNull(),
    /** api_sports.team_id do YAML (somente quando verificado); liga o perfil ao participante. */
    apiSportsTeamId: integer('api_sports_team_id'),
    names: jsonb('names').notNull(),
    labels: i18n('labels'),
    city: text('city'),
    region: text('region'),
    founded: date('founded'),
    colors: jsonb('colors').$type<string[]>().notNull().default([]),
    nicknames: jsonb('nicknames').$type<string[]>().notNull().default([]),
    fans: jsonb('fans'),
    mascot: text('mascot'),
    rallyingCries: jsonb('rallying_cries').$type<string[]>().notNull().default([]),
    stadium: jsonb('stadium'),
    rivals: jsonb('rivals').$type<TeamRival[]>().notNull().default([]),
    identity: jsonb('identity').$type<string[]>().notNull().default([]),
    copyHints: jsonb('copy_hints'),
    worldCupTitles: smallint('world_cup_titles'),
    /** Arquivo e versão de origem no repositório. */
    sourceFile: text('source_file').notNull(),
    sources: jsonb('sources').$type<string[]>().notNull().default([]),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    /** sha256 do item do YAML — o seed só reescreve a linha quando o conteúdo muda. */
    contentHash: text('content_hash'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('team_profile_participant_idx').on(t.participantId),
    index('team_profile_api_sports_idx').on(t.apiSportsTeamId),
  ],
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
  contentHash: text('content_hash'),
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
  /** api_sports_league_id do YAML; usado para ligar o perfil a core.competition via provider_map. */
  apiSportsLeagueId: integer('api_sports_league_id'),
  labels: i18n('labels'),
  nicknames: jsonb('nicknames'),
  trophyNickname: text('trophy_nickname'),
  sourceFile: text('source_file').notNull(),
  sources: jsonb('sources').$type<string[]>().notNull().default([]),
  reviewStatus: reviewStatus('review_status').notNull().default('draft'),
  contentHash: text('content_hash'),
  updatedAt: updatedAt(),
});

/** Microcopy por locale × esporte × intenção × intensidade (docs/06 §4). */
export const copyTemplate = semantic.table(
  'copy_template',
  {
    id: pkUuidV7(),
    /** Chave estável vinda do YAML (`<locale>.<key>`), usada no upsert idempotente do seed. */
    key: text('key').notNull(),
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
    sourceFile: text('source_file'),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    contentHash: text('content_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('copy_template_key_uq').on(t.key),
    index('copy_template_lookup_idx').on(t.locale, t.sport, t.copyIntent),
  ],
);

export const loadRun = semantic.table('load_run', {
  id: pkUuidV7(),
  gitSha: text('git_sha'),
  teams: smallint('teams').notNull(),
  derbies: smallint('derbies').notNull(),
  competitions: smallint('competitions').notNull(),
  copyTemplates: smallint('copy_templates').notNull().default(0),
  /** Inseridos/atualizados/removidos por entidade nesta carga. */
  stats: jsonb('stats'),
  loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
});
