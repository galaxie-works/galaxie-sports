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

type ReviewStatusValue = (typeof REVIEW_STATUSES)[number];
/** Textos de um time traduzidos para um locale (data/knowledge/i18n/<locale>.yaml). */
export type LocalizedTeamTexts = {
  identity?: string[];
  mascot?: string;
  colors?: string[];
  fans?: { demonym?: string; group_nicknames?: string[] };
  review_status: ReviewStatusValue;
};
/** Textos de um clássico traduzidos para um locale. */
export type LocalizedDerbyTexts = { origin?: string; trivia?: string[]; review_status: ReviewStatusValue };
/** Retrospecto histórico geral curado (bloco `all_time` do YAML), separado do calculado dos jogos da base. */
export type DerbyAllTime = {
  matches: number;
  draws: number;
  teams: { team: string; wins: number; goals?: number | null }[];
  basis: 'all' | 'official';
  as_of: string;
  sources: string[];
  review_status: ReviewStatusValue;
};

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
    /** F1: id do piloto ou construtor no F1DB (`f1db.id` do YAML); liga o perfil ao participante. */
    f1dbId: text('f1db_id'),
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
    /** Idioma dos textos livres do YAML (identity, mascot, colors, fans): pt-BR, es ou es-XX. */
    textLocale: text('text_locale').notNull().default('pt-BR'),
    /** Traduções de i18n/<locale>.yaml: `{ "es": { identity, mascot, colors, fans, review_status } }`. */
    texts: jsonb('texts').$type<Record<string, LocalizedTeamTexts>>().notNull().default({}),
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
  allTime: jsonb('all_time').$type<DerbyAllTime>(),
  /** Idioma de origin/trivia no YAML. */
  textLocale: text('text_locale').notNull().default('pt-BR'),
  /** Traduções de i18n/<locale>.yaml: `{ "es": { origin, trivia, review_status } }`. */
  texts: jsonb('texts').$type<Record<string, LocalizedDerbyTexts>>().notNull().default({}),
  sourceFile: text('source_file').notNull(),
  sources: jsonb('sources').$type<string[]>().notNull().default([]),
  reviewStatus: reviewStatus('review_status').notNull().default('draft'),
  contentHash: text('content_hash'),
  updatedAt: updatedAt(),
});

/** Par relevante que não é clássico, com histórico geral curado (data/knowledge/<esporte>/head-to-head). */
export const headToHead = semantic.table(
  'head_to_head',
  {
    slug: text('slug').primaryKey(),
    sport: text('sport').notNull(),
    /** Os dois slugs de team_profile, em ordem alfabética. */
    teams: jsonb('teams').$type<[string, string]>().notNull(),
    allTime: jsonb('all_time').$type<DerbyAllTime>().notNull(),
    sourceFile: text('source_file').notNull(),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    contentHash: text('content_hash'),
    updatedAt: updatedAt(),
  },
  (t) => [index('head_to_head_teams_idx').using('gin', t.teams)],
);

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

// ─── revisão editorial pelo painel (docs/06 §2.1) ──────────────────────────────────────────────────

/** Sugestão de edição guardada pelo painel: comentário e, opcionalmente, valores propostos por campo. */
export type ReviewSuggestion = { comment: string; fields: Record<string, unknown> | null };

/**
 * Veredito do agente de revisão de sugestões (`review-suggestions`) sobre a sugestão em aberto. Na
 * recusa, o item segue "precisa de revisão" e o painel mostra o motivo; o painel apaga o veredito
 * quando a decisão muda (nova sugestão, aprovar, voltar para rascunho).
 */
export type ReviewAiVerdict = {
  outcome: 'accepted' | 'adjusted' | 'rejected';
  reason: string;
  /** Campos finais aplicados (aceita) ou propostos pelo modelo (recusa), quando houver. */
  fields: Record<string, unknown> | null;
  /** Ajustes pequenos feitos pelo modelo na edição proposta (vírgula, aspas...). */
  adjustments: string[];
  /** Falhou na validação determinística (schema, variáveis, campos editáveis) depois do modelo. */
  validation: string[];
  /** Quem decidiu: o provedor do modelo (`gemini` em produção). */
  by: string;
  model: string;
  at: string;
};

/**
 * Catálogo do que pode ser revisado (perfis, clássicos, competições, copy, glossário e traduções),
 * reescrito pelo seed a cada carga a partir do YAML. O painel lista e mostra o conteúdo daqui.
 */
export const reviewItem = semantic.table(
  'review_item',
  {
    /** `<tipo>:<chave>` (ex.: `team:palmeiras`, `translation:team:palmeiras:es`). */
    id: text('id').primaryKey(),
    /** team | derby | competition | copy | glossary | translation */
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    locale: text('locale'),
    sport: text('sport').notNull(),
    /** País/mercado (ISO2 maiúsculo; INT = clássico entre países). */
    market: text('market'),
    title: text('title').notNull(),
    sourceFile: text('source_file').notNull(),
    /** Status escrito no YAML (o efetivo depende de semantic.review_decision). */
    yamlStatus: reviewStatus('yaml_status').notNull(),
    /** sha256 do conteúdo revisável; a decisão só vale enquanto for igual ao dela. */
    reviewHash: text('review_hash').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    /** Traduções: campos do original no idioma-base. */
    original: jsonb('original').$type<Record<string, unknown>>(),
    originalLocale: text('original_locale'),
    /** Traduções: team | derby. */
    parentKind: text('parent_kind'),
    updatedAt: updatedAt(),
  },
  (t) => [index('review_item_filter_idx').on(t.kind, t.sport, t.market)],
);

/**
 * Decisão de revisão vigente por item, gravada só pelo painel (o seed lê, nunca escreve). É a fonte da
 * verdade do status enquanto `review_hash` bater com o do conteúdo atual do YAML.
 */
export const reviewDecision = semantic.table('review_decision', {
  itemId: text('item_id').primaryKey(),
  status: reviewStatus('status').notNull(),
  reviewHash: text('review_hash').notNull(),
  /** Sugestão de edição em aberto (o item fica "precisa de revisão" e não é servido). */
  suggestion: jsonb('suggestion').$type<ReviewSuggestion>(),
  decidedBy: text('decided_by').notNull(),
  decidedById: text('decided_by_id'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  /** Veredito do agente sobre a sugestão desta decisão (null = ainda não avaliada). */
  aiVerdict: jsonb('ai_verdict').$type<ReviewAiVerdict>(),
});

/**
 * Edição de conteúdo aprovada fora do YAML (hoje, pelo agente de revisão de sugestões), aplicada por
 * cima do YAML no seed e na leitura do glossário pela API — o próximo deploy não a desfaz. Campo a
 * campo (chaves de primeiro nível do conteúdo do item): `fields` = valor novo (null = remover),
 * `base` = valor do YAML quando a edição foi feita. Se o YAML mudar um desses campos para um terceiro
 * valor, vale o YAML (conflito); se o YAML já tiver o valor novo (exportado), a edição é absorvida.
 * Desenho em docs/06 §2.1.
 */
export const reviewOverride = semantic.table('review_override', {
  itemId: text('item_id').primaryKey(),
  fields: jsonb('fields').$type<Record<string, unknown>>().notNull(),
  base: jsonb('base').$type<Record<string, unknown>>().notNull(),
  /** review_hash do conteúdo com a edição aplicada (o da decisão aprovada junto). */
  reviewHash: text('review_hash').notNull(),
  /** Quem aprovou a edição (`gemini` no agente). */
  source: text('source').notNull(),
  reason: text('reason'),
  /** Sugestão do painel que originou a edição. */
  suggestion: jsonb('suggestion').$type<ReviewSuggestion>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Auditoria das ações do painel: quem, quando, o quê (status de/para, comentário e edição proposta). */
export const reviewLog = semantic.table(
  'review_log',
  {
    id: pkUuidV7(),
    itemId: text('item_id').notNull(),
    /** approve | draft | suggest */
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: reviewStatus('to_status').notNull(),
    reviewHash: text('review_hash').notNull(),
    comment: text('comment'),
    proposed: jsonb('proposed').$type<Record<string, unknown>>(),
    actor: text('actor').notNull(),
    actorId: text('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [index('review_log_item_idx').on(t.itemId, t.createdAt)],
);
