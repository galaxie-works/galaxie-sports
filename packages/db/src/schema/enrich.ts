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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pkUuidV7 } from './_shared.js';
import { asset, competition, event, participant } from './core.js';

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
  /** Tabela de direitos (curada em config/broadcast-rights ou pesquisada por temporada). */
  'rights',
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

/**
 * Janelas por jogo. T-7d publica a resposta dos direitos (sem LLM); T-48h é a alocação por rodada
 * (LLM só quando os direitos dividem os jogos); T-3h e T-30min só revalidam. `T-24h` fica para o
 * histórico do desenho anterior (busca completa por jogo).
 */
export const WTW_WINDOWS = ['T-7d', 'T-48h', 'T-24h', 'T-3h', 'T-30min', 'manual'] as const;
export type WtwWindow = (typeof WTW_WINDOWS)[number];
export const WTW_RUN_MODES = ['rights', 'allocate', 'revalidate', 'full'] as const;
export type WtwRunMode = (typeof WTW_RUN_MODES)[number];

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
    /**
     * rights = só a resposta dos direitos (sem LLM) · allocate = alocação por rodada (LLM só se os
     * direitos dividem os jogos) · revalidate = refaz o fetch das URLs salvas (sem LLM) ·
     * full = busca aberta (reexecução manual e histórico).
     */
    mode: text('mode').$type<WtwRunMode>().notNull(),
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

// ─── conteúdo relacionado por evento (docs/12) ───────────────────────────────────────────────────

/** Tipo de conteúdo de um vídeo relacionado ao evento (docs/12 §4.1). */
export const RELATED_CONTENT_TYPES = [
  'highlights',
  'goal',
  'penalties',
  'press_conference',
  'interview',
  'behind_the_scenes',
  'fan_reaction',
  'analysis',
  'full_match',
  'other',
] as const;
export type RelatedContentType = (typeof RELATED_CONTENT_TYPES)[number];
export const relatedContentType = enrich.enum('related_content_type', RELATED_CONTENT_TYPES);

/** short = vertical curto (Shorts) · long = vídeo horizontal de qualquer duração (docs/12 §4.2). */
export const RELATED_FORMATS = ['short', 'long'] as const;
export type RelatedFormat = (typeof RELATED_FORMATS)[number];

/**
 * published = aparece na API · pending = guardado, não aparece (revisão) · rejected = descartado pela
 * política (direitos, relevância) · retracted = saiu do ar · expired = sem atualização há 30 dias
 * (título, miniatura e estatísticas apagados; o id e a classificação ficam).
 */
export const RELATED_STATUSES = ['published', 'pending', 'rejected', 'retracted', 'expired'] as const;
export type RelatedStatus = (typeof RELATED_STATUSES)[number];
export const relatedContentStatus = enrich.enum('related_content_status', RELATED_STATUSES);

/** Confiança do canal: allowlist (oficial, detentor de direitos, imprensa), criador ou desconhecido. */
export const RELATED_SOURCE_TIERS = ['official', 'rights_holder', 'media', 'creator', 'unknown'] as const;
export type RelatedSourceTier = (typeof RELATED_SOURCE_TIERS)[number];

/**
 * Proporção do quadro do vídeo, das dimensões reais do player da plataforma (a mais próxima destas);
 * sem dimensões, vem do formato (short → 9:16, long → 16:9).
 */
export const RELATED_ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1'] as const;
export type RelatedAspectRatio = (typeof RELATED_ASPECT_RATIOS)[number];

export type RelatedStatistics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  fetchedAt: string;
};

/**
 * Vídeo relacionado a um evento: só metadados e o link/embed oficial da plataforma (nunca rehospedado).
 * Versionado como o onde assistir: cada mudança material cria uma linha nova e aposenta a anterior.
 */
export const relatedContent = enrich.table(
  'related_content',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** youtube (instagram, tiktok no futuro). */
    provider: text('provider').notNull(),
    /** Id do vídeo na plataforma. */
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    embedUrl: text('embed_url'),
    title: text('title').notNull(),
    /** ≤ 200 caracteres, para auditoria da classificação. */
    descriptionExcerpt: text('description_excerpt'),
    channelId: text('channel_id').notNull(),
    channelTitle: text('channel_title').notNull(),
    channelHandle: text('channel_handle'),
    sourceTier: text('source_tier').$type<RelatedSourceTier>().notNull(),
    contentType: relatedContentType('content_type').notNull(),
    format: text('format').$type<RelatedFormat>().notNull(),
    /** 16:9 (horizontal) | 9:16 (vertical) | 4:3 | 1:1 — ver RELATED_ASPECT_RATIOS. */
    aspectRatio: text('aspect_ratio').$type<RelatedAspectRatio>().notNull(),
    durationSeconds: integer('duration_seconds'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    /** URL da própria plataforma (i.ytimg.com), nunca do nosso CDN. */
    thumbnailUrl: text('thumbnail_url'),
    /** Idioma da consulta que achou o vídeo (pt, es). */
    language: text('language'),
    statistics: jsonb('statistics').$type<RelatedStatistics>(),
    rankScore: numeric('rank_score', { precision: 6, scale: 3 }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    /** llm:<modelo> | rules@v1 */
    classifiedBy: text('classified_by').notNull(),
    status: relatedContentStatus('status').notNull(),
    /** rights_risk, injection_signal, offensive_title, low_confidence... */
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Consultas (rótulos) que acharam o vídeo. */
    queries: text('queries')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    runId: uuid('run_id'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededBy: uuid('superseded_by'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('related_content_current_uq')
      .on(t.eventId, t.provider, t.externalId)
      .where(sql`${t.supersededBy} is null`),
    index('related_content_event_idx').on(t.eventId, t.status),
    index('related_content_checked_idx')
      .on(t.lastCheckedAt)
      .where(sql`${t.supersededBy} is null`),
  ],
);

/** Modo de uma execução por jogo: busca completa, só os canais conhecidos ou só a revalidação. */
export type RelatedRunMode = 'full' | 'channels' | 'revalidate';

/**
 * Execuções do agente de conteúdo relacionado, por dia de cota do YouTube (meia-noite do Pacífico). A cota tem
 * dois baldes: `searches` (consultas `search.list`, ~100/dia) e `api_units` (videos, channels e playlistItems,
 * 10.000 unidades/dia). `quota_units` até a 0039 somava 100 por busca (modelo antigo); desde a 0039 é
 * `searches + api_units`.
 */
export const relatedRun = enrich.table(
  'related_run',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** full = canais + busca · channels = só os canais conhecidos · revalidate = só videos.list dos ids guardados. */
    mode: text('mode').$type<RelatedRunMode>().notNull(),
    /** running | done | failed | skipped */
    status: text('status').notNull().default('running'),
    /** Dia da cota do YouTube (zera à meia-noite do Pacífico). */
    quotaDay: date('quota_day').notNull(),
    quotaUnits: integer('quota_units').notNull().default(0),
    /** Unidades do balde geral (videos, channels, playlistItems). */
    apiUnits: integer('api_units').notNull().default(0),
    /** Consultas `search.list` (balde próprio). */
    searches: integer('searches').notNull().default(0),
    candidates: integer('candidates').notNull().default(0),
    published: integer('published').notNull().default(0),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    stats: jsonb('stats'),
    error: text('error'),
    /** cli | scheduler | editorial:<usuario> */
    requestedBy: text('requested_by').notNull().default('cli'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('related_run_event_idx').on(t.eventId, t.startedAt),
    index('related_run_quota_idx').on(t.quotaDay),
  ],
);

/**
 * Cache permanente do `channels.list` (docs/12 §3.2): id do canal → playlist de uploads, handle, título e
 * inscritos. A playlist de uploads não muda; os inscritos servem ao piso da allowlist.
 */
export const youtubeChannel = enrich.table(
  'youtube_channel',
  {
    /** Id do canal (UC…). */
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /** `snippet.customUrl` em minúsculas, com "@". */
    handle: text('handle'),
    /** Playlist de uploads (UU…). */
    uploadsPlaylistId: text('uploads_playlist_id'),
    country: text('country'),
    subscribers: integer('subscribers'),
    /** O `channels.list` não devolveu o canal (removido ou id errado). */
    missing: boolean('missing').notNull().default(false),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('youtube_channel_handle_idx').on(t.handle)],
);

export const RELATED_CHANNEL_KINDS = ['club', 'competition', 'broadcaster'] as const;
export type RelatedChannelKind = (typeof RELATED_CHANNEL_KINDS)[number];
/** wikidata = P2397 do QID do time/competição (casamento estrito) · config = channels.yaml e dicionário de emissoras. */
export type RelatedChannelSource = 'wikidata' | 'config';

/**
 * Mapa de canais oficiais do Conteúdo relacionado (docs/12 §3.2): canal do clube, da competição ou da emissora,
 * com a fonte. O agente lê os uploads recentes desses canais (1 unidade por página) antes de gastar a busca.
 */
export const relatedChannel = enrich.table(
  'related_channel',
  {
    id: pkUuidV7(),
    channelId: text('channel_id').notNull(),
    kind: text('kind').$type<RelatedChannelKind>().notNull(),
    participantId: uuid('participant_id').references(() => participant.id, { onDelete: 'cascade' }),
    competitionId: uuid('competition_id').references(() => competition.id, { onDelete: 'cascade' }),
    /** Id do dicionário de emissoras (kind = broadcaster). */
    broadcasterId: text('broadcaster_id'),
    /** País do canal no mapa (emissora: o mercado). */
    country: text('country'),
    source: text('source').$type<RelatedChannelSource>().notNull(),
    /** QID do Wikidata ou o arquivo de configuração. */
    sourceRef: text('source_ref'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('related_channel_uq')
      .on(t.channelId, t.kind, t.participantId, t.competitionId, t.broadcasterId)
      .nullsNotDistinct(),
    index('related_channel_participant_idx').on(t.participantId),
    index('related_channel_competition_idx').on(t.competitionId),
  ],
);

/** Jogo que ficou sem busca (ou sem vídeo) por causa da cota, para o painel de Operação. */
export interface RelatedSkippedGame {
  eventId: string;
  label: string;
  competition: string | null;
  relevance: number;
  score: number;
  reason: string;
  at: string;
}

/** Jogo da agenda que ainda vai acontecer no dia de cota, com a fatia reservada para ele. */
export interface RelatedUpcomingGame {
  eventId: string;
  startsAt: string;
  score: number;
  reserved: number;
}

/**
 * Orçamento do YouTube por dia de cota, gravado a cada execução do `related:run` (painel de Operação): gasto,
 * reservado para os jogos que ainda vão acontecer e livre, nos dois baldes, e os jogos pulados por cota.
 */
export const relatedBudget = enrich.table('related_budget', {
  quotaDay: date('quota_day').primaryKey(),
  searchLimit: integer('search_limit').notNull(),
  searchUsed: integer('search_used').notNull().default(0),
  searchReserved: integer('search_reserved').notNull().default(0),
  apiLimit: integer('api_limit').notNull(),
  apiUsed: integer('api_used').notNull().default(0),
  skipped: jsonb('skipped').$type<RelatedSkippedGame[]>().notNull().default([]),
  upcoming: jsonb('upcoming').$type<RelatedUpcomingGame[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tipo da emissora na biblioteca: TV aberta, TV paga (cabo/satélite/IPTV), streaming ou rádio. */
export const BROADCASTER_KINDS = ['free_tv', 'pay_tv', 'streaming', 'radio'] as const;
export type BroadcasterKind = (typeof BROADCASTER_KINDS)[number];

/** Dados de uma emissora num país (do dicionário config/broadcasters/<iso2>.yaml). */
export type BroadcasterMarket = {
  name: string;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  channels: string[];
  domains: string[];
};

/** Logo de um canal da emissora (acervo oficial): nome do canal e os assets das versões clara e escura. */
export type BroadcasterChannelLogo = {
  name: string;
  assetId: string | null;
  darkAssetId: string | null;
};

/**
 * Biblioteca de emissoras e plataformas (sincronizada do dicionário por país). O logo é um asset
 * espelhado no nosso storage; `logo_source_*` guardam a origem e a licença/observação de uso.
 */
export const broadcaster = enrich.table('broadcaster', {
  /** Id canônico do dicionário (ex.: globo, espn). */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  kind: text('kind').$type<BroadcasterKind>().notNull(),
  countries: text('countries')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  channels: text('channels')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  website: text('website'),
  markets: jsonb('markets').$type<Record<string, BroadcasterMarket>>().notNull(),
  logoAssetId: uuid('logo_asset_id').references(() => asset.id),
  /** URL do arquivo de origem do logo (site oficial ou Wikimedia Commons). */
  logoSourceUrl: text('logo_source_url'),
  /** Página de origem (descrição do arquivo, press kit). */
  logoSourcePage: text('logo_source_page'),
  /** Licença ou observação de uso (ex.: domínio público; uso nominativo para identificar a emissora). */
  logoLicense: text('logo_license'),
  /** Versão do logo para fundo escuro (acervo oficial); null = usar `logo_asset_id`. */
  logoDarkAssetId: uuid('logo_dark_asset_id').references(() => asset.id),
  /** Logos dos canais (acervo oficial), pela chave normalizada do nome do canal ("espn2"). */
  channelLogos: jsonb('channel_logos').$type<Record<string, BroadcasterChannelLogo>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Regra de distribuição dos jogos entre os detentores (docs/07 §2.2). */
export const RIGHTS_DISTRIBUTIONS = ['exclusive', 'all_matches', 'split', 'selected', 'to_confirm'] as const;
export type RightsDistribution = (typeof RIGHTS_DISTRIBUTIONS)[number];

/** Detentor validado de uma pesquisa de direitos. */
export type RightsHolderRecord = {
  /** Id do dicionário; null = nome desconhecido (fica fora da publicação). */
  broadcasterId: string | null;
  name: string;
  channels: string[];
  kind: BroadcasterKind | null;
  /** Transmite todos os jogos da competição nesse país. */
  allMatches: boolean;
  status: 'confirmed' | 'pending';
  confidence: number;
  evidence: Evidence[];
  flags: string[];
};

/**
 * Direitos de transmissão pesquisados por temporada (camada abaixo da curada em
 * config/broadcast-rights, que sempre vence). Versionado como broadcast_option: cada mudança
 * material vira uma linha nova e a anterior recebe `superseded_by`.
 */
export const broadcastRights = enrich.table(
  'broadcast_rights',
  {
    id: pkUuidV7(),
    competitionSlug: text('competition_slug').notNull(),
    /** Ano de início da temporada (rótulo da api-sports). */
    season: integer('season').notNull(),
    countryCode: text('country_code').notNull(),
    distribution: text('distribution').$type<RightsDistribution>().notNull(),
    holders: jsonb('holders').$type<RightsHolderRecord[]>().notNull(),
    /** confirmed = usável · pending = não usada (revisão) · retracted = lápide. */
    status: text('status').$type<'confirmed' | 'pending' | 'retracted'>().notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    notes: text('notes'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** agent:wtw-rights@v1 */
    producedBy: text('produced_by').notNull(),
    /** Pesquisa (enrich.wtw_research) que produziu esta versão. */
    researchId: uuid('research_id'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededBy: uuid('superseded_by'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    index('broadcast_rights_current_idx')
      .on(t.competitionSlug, t.season, t.countryCode)
      .where(sql`${t.supersededBy} is null`),
  ],
);

/**
 * Chamadas de pesquisa do onde assistir que cobrem vários mercados de uma vez: direitos por
 * temporada (`rights`) e alocação por rodada (`allocation`). O custo é rateado pelos mercados da
 * chamada no teto diário por mercado (WTW_DAILY_USD_PER_MARKET).
 */
export const wtwResearch = enrich.table(
  'wtw_research',
  {
    id: pkUuidV7(),
    /** rights = direitos por temporada · allocation = alocação por rodada · channel = canal do jogo. */
    kind: text('kind').$type<'rights' | 'allocation' | 'channel'>().notNull(),
    /** Chave idempotente (ex.: rights:<competição>:<temporada>:<mercados>). */
    researchKey: text('research_key').notNull(),
    competitionSlug: text('competition_slug').notNull(),
    season: integer('season'),
    /** Rodada (rótulo do fornecedor) ou data, na alocação. */
    round: text('round'),
    markets: text('markets').array().notNull(),
    /** running | done | failed | skipped */
    status: text('status').notNull().default('running'),
    requestedBy: text('requested_by').notNull().default('scheduler'),
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
    uniqueIndex('wtw_research_key_uq').on(t.researchKey),
    index('wtw_research_created_idx').on(t.createdAt),
  ],
);

/**
 * Canal do jogo (docs/07 §2.2.4): por jogo × país, qual detentor dos direitos passa (ou passou) o jogo,
 * com a fonte que diz isso. Gravado pelo job `wtw-channel` só depois do validador determinístico
 * (detentor conhecido da competição no país, fonte oficial ou imprensa esportiva, trecho com os dois
 * times e o canal); na dúvida, nada é gravado e o jogo segue "a confirmar".
 */
export const MATCH_CHANNEL_STATUSES = ['confirmed', 'retracted'] as const;
export type MatchChannelStatus = (typeof MATCH_CHANNEL_STATUSES)[number];
/** official = organizador ou a própria emissora (e o grupo dela) · press = imprensa esportiva. */
export const MATCH_CHANNEL_SOURCE_KINDS = ['official', 'press', 'editorial'] as const;
export type MatchChannelSourceKind = (typeof MATCH_CHANNEL_SOURCE_KINDS)[number];
/** Momento da confirmação: antes do jogo (escala da rodada) ou depois (quem transmitiu). */
export const MATCH_CHANNEL_PHASES = ['pre', 'post'] as const;
export type MatchChannelPhase = (typeof MATCH_CHANNEL_PHASES)[number];

export type MatchChannelEvidence = {
  url: string;
  publisher: string;
  /** Trecho (≤ 200 caracteres) com os dois times e o canal — paráfrase curta, nunca a matéria. */
  excerpt: string;
  /** Tipo do domínio (o validador só aceita estes): emissora/grupo e organizador = oficial. */
  sourceKind: Extract<SourceKind, 'broadcaster' | 'organizer' | 'press' | 'editorial'>;
  publishedAt: string | null;
  /** A página respondeu e cita os dois times e o canal (true) · não foi possível buscar (null). */
  pageVerified: boolean | null;
  fetchedAt: string;
};

export const matchChannel = enrich.table(
  'match_channel',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(),
    /** Detentor (id da biblioteca de emissoras, config/broadcasters). */
    broadcasterId: text('broadcaster_id').notNull(),
    /** Canal específico da emissora (ex.: "SporTV 2"), quando a fonte diz. */
    channelName: text('channel_name'),
    status: text('status').$type<MatchChannelStatus>().notNull().default('confirmed'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
    /** Melhor fonte (oficial vale mais que imprensa). */
    sourceKind: text('source_kind').$type<MatchChannelSourceKind>().notNull(),
    sourceUrl: text('source_url').notNull(),
    sourcePublisher: text('source_publisher').notNull(),
    sourceExcerpt: text('source_excerpt').notNull(),
    sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
    evidence: jsonb('evidence').$type<MatchChannelEvidence[]>().notNull(),
    /** Fase da última confirmação. */
    phase: text('phase').$type<MatchChannelPhase>().notNull(),
    /** Janela que confirmou por último (T-5d, T-48h, T-6h, post, import). */
    window: text('window').notNull(),
    /** Pesquisa (enrich.wtw_research) da última confirmação; null = importado das opções salvas. */
    researchId: uuid('research_id'),
    firstConfirmedAt: timestamp('first_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Confirmado também depois do jogo (quem de fato transmitiu). */
    postConfirmedAt: timestamp('post_confirmed_at', { withTimezone: true }),
    retractedAt: timestamp('retracted_at', { withTimezone: true }),
    retractedReason: text('retracted_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('match_channel_event_country_broadcaster_uq').on(t.eventId, t.countryCode, t.broadcasterId),
    index('match_channel_event_country_idx').on(t.eventId, t.countryCode, t.status),
  ],
);
