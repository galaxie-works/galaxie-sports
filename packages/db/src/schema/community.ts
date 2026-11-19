/**
 * Comunidades (épico #936, #939), schema `community`: a rede social privada de torcedores de cada cliente, uma
 * Comunidade por Âncora (esporte, campeonato, time ou atleta). O cliente liga um escopo e as Comunidades nascem
 * sozinhas; o torcedor nunca cria.
 *
 * - `scope_rule`: o escopo que o cliente ligou. Cada regra vira uma ou mais Âncoras (`@galaxie/engage`,
 *   `community.ts`); sair do escopo arquiva a Comunidade, sem apagar;
 * - `community`: a Comunidade da Âncora no cliente, com Modo de entrada, post de membro e Chat da Comunidade. Não tem
 *   nome gravado: o nome vem da Âncora, na leitura (nome de competição não se traduz). `UNIQUE (tenant_id,
 *   anchor_type, anchor_id)` garante uma só por Âncora, mesmo com dois cliques ao mesmo tempo;
 * - `terms_version` e `acceptance`: os termos da Comunidade por versão e o Aceite de cada Perfil (Google Play UGC);
 * - `membership`: quem é membro (o Perfil da base, `fan.profile`, #937), com estado e data de entrada;
 * - `join_request` e `invite`: a fila da entrada com aprovação e os convites da entrada fechada.
 *
 * `tenant_id` abre a chave primária e todos os índices; membro, pedido e Aceite apontam para a Comunidade e para o
 * Perfil por chave composta, então o banco recusa membro de um cliente numa Comunidade de outro. A Âncora fica sem
 * chave estrangeira: o espelho reorganiza o que é dele (o mesmo vale para `chat.room.event_id`).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { fanProfile } from './fan.js';

export const community = pgSchema('community');

/**
 * Tipos de Âncora. `sport` aponta para `core.sport.slug`; `competition`, `participant` (time, seleção ou atleta
 * individual, como um piloto) e `person` (atleta de elenco, como um jogador de futebol) para o `id` da tabela de mesmo
 * nome no `core`.
 */
export const COMMUNITY_ANCHOR_TYPES = ['sport', 'competition', 'participant', 'person'] as const;
export type CommunityAnchorType = (typeof COMMUNITY_ANCHOR_TYPES)[number];

/**
 * Regras de escopo. As de um alvo só criam uma Comunidade; `competition_participants` cria uma para cada time ou atleta
 * da temporada atual do campeonato (o caso "todos os times do Brasileirão").
 */
export const COMMUNITY_SCOPE_KINDS = [
  'sport',
  'competition',
  'competition_participants',
  'participant',
  'person',
] as const;
export type CommunityScopeKind = (typeof COMMUNITY_SCOPE_KINDS)[number];

/** Aberta (entra direto), com aprovação (fila do cliente) ou fechada (só com convite). */
export const COMMUNITY_JOIN_MODES = ['open', 'approval', 'closed'] as const;
export type CommunityJoinMode = (typeof COMMUNITY_JOIN_MODES)[number];

/**
 * `active` aparece para o torcedor; `archived` saiu do escopo (volta a `active` se o escopo voltar); `suspended` foi
 * suspensa pela Galaxie e só a Galaxie reativa.
 */
export const COMMUNITY_STATES = ['active', 'archived', 'suspended'] as const;
export type CommunityState = (typeof COMMUNITY_STATES)[number];

/** `active` é membro; `left` saiu por conta própria; `removed` foi tirado pela equipe (pode voltar só com convite). */
export const COMMUNITY_MEMBERSHIP_STATES = ['active', 'left', 'removed'] as const;
export type CommunityMembershipState = (typeof COMMUNITY_MEMBERSHIP_STATES)[number];

export const COMMUNITY_JOIN_REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type CommunityJoinRequestState = (typeof COMMUNITY_JOIN_REQUEST_STATES)[number];

/** Termos nos três idiomas da plataforma. */
export type CommunityTermsBody = { pt: string; es: string; en: string };

const inList = (col: string, list: readonly string[]) =>
  sql.raw(`${col} in (${list.map((v) => `'${v}'`).join(', ')})`);

const communityId = () =>
  uuid('id')
    .notNull()
    .default(sql`public.uuid_generate_v7()`);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' });

export const communityScopeRule = community.table(
  'scope_rule',
  {
    tenantId: tenantRef(),
    id: communityId(),
    kind: text('kind').$type<CommunityScopeKind>().notNull(),
    /** Slug do esporte (`sport`) ou `id` do `core` (os demais), em texto. */
    target: text('target').notNull(),
    /** `tenant:<e-mail do console>`, `galaxie:<id>` ou `migration`. */
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    /** Desligada: as Comunidades que só ela sustentava são arquivadas. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by'),
  },
  (t) => [
    primaryKey({ name: 'scope_rule_pkey', columns: [t.tenantId, t.id] }),
    uniqueIndex('scope_rule_active_uq')
      .on(t.tenantId, t.kind, t.target)
      .where(sql`${t.removedAt} is null`),
    check('scope_rule_kind', inList('kind', COMMUNITY_SCOPE_KINDS)),
    check('scope_rule_target_len', sql`length(${t.target}) between 1 and 80`),
  ],
);

export const communityCommunity = community.table(
  'community',
  {
    tenantId: tenantRef(),
    id: communityId(),
    anchorType: text('anchor_type').$type<CommunityAnchorType>().notNull(),
    /** Slug do esporte ou `id` do `core`, em texto (sem chave estrangeira). */
    anchorId: text('anchor_id').notNull(),
    joinMode: text('join_mode').$type<CommunityJoinMode>().notNull().default('open'),
    /** Post de membro no Feed (#946). Desligado, só a equipe e os posts automáticos publicam. */
    memberPosts: boolean('member_posts').notNull().default(true),
    /** Chat da Comunidade, permanente e só para membros. O cliente liga. */
    chatEnabled: boolean('chat_enabled').notNull().default(false),
    /** Janela de exibição do Feed e do Chat em dias; null = padrão da Galaxie (teto de 2 anos, nunca a Guarda legal). */
    historyDays: integer('history_days'),
    state: text('state').$type<CommunityState>().notNull().default('active'),
    /** Quem mudou o estado por último: `tenant:<…>`, `galaxie:<id>`, `system`. */
    stateBy: text('state_by'),
    stateAt: timestamp('state_at', { withTimezone: true }),
    /** Versão dos termos em vigor; null = sem termos próprios (vale só a regra de conduta da base). */
    termsVersion: integer('terms_version'),
    /** Versão otimista da configuração (o console manda a que leu). */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'community_pkey', columns: [t.tenantId, t.id] }),
    uniqueIndex('community_anchor_uq').on(t.tenantId, t.anchorType, t.anchorId),
    index('community_state_idx').on(t.tenantId, t.state),
    check('community_anchor_type', inList('anchor_type', COMMUNITY_ANCHOR_TYPES)),
    check('community_anchor_id_len', sql`length(${t.anchorId}) between 1 and 80`),
    check('community_join_mode', inList('join_mode', COMMUNITY_JOIN_MODES)),
    check('community_state', inList('state', COMMUNITY_STATES)),
    check('community_history_days', sql`${t.historyDays} is null or ${t.historyDays} between 1 and 730`),
    check('community_terms_version', sql`${t.termsVersion} is null or ${t.termsVersion} >= 1`),
  ],
);

export const communityTermsVersion = community.table(
  'terms_version',
  {
    tenantId: tenantRef(),
    communityId: uuid('community_id').notNull(),
    version: integer('version').notNull(),
    body: jsonb('body').$type<CommunityTermsBody>().notNull(),
    publishedBy: text('published_by').notNull(),
    publishedAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'terms_version_pkey', columns: [t.tenantId, t.communityId, t.version] }),
    foreignKey({
      name: 'terms_version_community_fk',
      columns: [t.tenantId, t.communityId],
      foreignColumns: [communityCommunity.tenantId, communityCommunity.id],
    }).onDelete('cascade'),
    check('terms_version_positive', sql`${t.version} >= 1`),
  ],
);

/** Aceite dos termos por Perfil e versão. Só cresce: aceitar a versão nova não apaga a antiga. */
export const communityAcceptance = community.table(
  'acceptance',
  {
    tenantId: tenantRef(),
    communityId: uuid('community_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    version: integer('version').notNull(),
    acceptedAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'acceptance_pkey', columns: [t.tenantId, t.communityId, t.profileId, t.version] }),
    foreignKey({
      name: 'acceptance_terms_fk',
      columns: [t.tenantId, t.communityId, t.version],
      foreignColumns: [
        communityTermsVersion.tenantId,
        communityTermsVersion.communityId,
        communityTermsVersion.version,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'acceptance_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
  ],
);

export const communityMembership = community.table(
  'membership',
  {
    tenantId: tenantRef(),
    communityId: uuid('community_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    state: text('state').$type<CommunityMembershipState>().notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** Quem tirou (`removed`): `tenant:<…>`, `galaxie:<id>` ou `system`. */
    removedBy: text('removed_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'membership_pkey', columns: [t.tenantId, t.communityId, t.profileId] }),
    foreignKey({
      name: 'membership_community_fk',
      columns: [t.tenantId, t.communityId],
      foreignColumns: [communityCommunity.tenantId, communityCommunity.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    // as Comunidades do torcedor e a lista de membros por data de entrada
    index('membership_profile_idx').on(t.tenantId, t.profileId, t.state),
    index('membership_community_idx').on(t.tenantId, t.communityId, t.state, t.joinedAt),
    check('membership_state', inList('state', COMMUNITY_MEMBERSHIP_STATES)),
  ],
);

export const communityJoinRequest = community.table(
  'join_request',
  {
    tenantId: tenantRef(),
    id: communityId(),
    communityId: uuid('community_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    state: text('state').$type<CommunityJoinRequestState>().notNull().default('pending'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
  },
  (t) => [
    primaryKey({ name: 'join_request_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'join_request_community_fk',
      columns: [t.tenantId, t.communityId],
      foreignColumns: [communityCommunity.tenantId, communityCommunity.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'join_request_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    // um pedido aberto por torcedor e Comunidade
    uniqueIndex('join_request_pending_uq')
      .on(t.tenantId, t.communityId, t.profileId)
      .where(sql`${t.state} = 'pending'`),
    index('join_request_queue_idx').on(t.tenantId, t.communityId, t.state, t.createdAt),
    check('join_request_state', inList('state', COMMUNITY_JOIN_REQUEST_STATES)),
  ],
);

/**
 * Convite da entrada fechada. Só o hash do código fica no banco (sha-256 em hex); o código sai uma vez, na criação.
 */
export const communityInvite = community.table(
  'invite',
  {
    tenantId: tenantRef(),
    id: communityId(),
    communityId: uuid('community_id').notNull(),
    codeHash: text('code_hash').notNull(),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'invite_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'invite_community_fk',
      columns: [t.tenantId, t.communityId],
      foreignColumns: [communityCommunity.tenantId, communityCommunity.id],
    }).onDelete('cascade'),
    uniqueIndex('invite_code_uq').on(t.tenantId, t.codeHash),
    check('invite_code_hash', sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check('invite_max_uses', sql`${t.maxUses} is null or ${t.maxUses} between 1 and 100000`),
    check('invite_uses', sql`${t.uses} >= 0 and (${t.maxUses} is null or ${t.uses} <= ${t.maxUses})`),
  ],
);

// ---------------------------------------------------------------- Feed (#946)

/** Quem publicou: o sistema (post automático do jogo), a equipe do cliente ou um membro. */
export const COMMUNITY_POST_AUTHORS = ['system', 'staff', 'member'] as const;
export type CommunityPostAuthor = (typeof COMMUNITY_POST_AUTHORS)[number];

/** Card anexado ao post: um jogo, um time ou atleta, ou um jogador (ids do `core`, sem chave estrangeira). */
export const COMMUNITY_POST_ATTACHMENTS = ['event', 'participant', 'person'] as const;
export type CommunityPostAttachment = (typeof COMMUNITY_POST_ATTACHMENTS)[number];

/**
 * `public` aparece para os membros; `shadow` só o autor vê (abuso ou Silêncio oculto); `hidden` foi tirado pela
 * moderação. Igual ao chat.
 */
export const COMMUNITY_CONTENT_VISIBILITY = ['public', 'shadow', 'hidden'] as const;
export type CommunityContentVisibility = (typeof COMMUNITY_CONTENT_VISIBILITY)[number];

export const COMMUNITY_REACTIONS = ['like'] as const;
export type CommunityReaction = (typeof COMMUNITY_REACTIONS)[number];

export const communityPost = community.table(
  'post',
  {
    tenantId: tenantRef(),
    id: communityId(),
    communityId: uuid('community_id').notNull(),
    author: text('author').$type<CommunityPostAuthor>().notNull(),
    /** Perfil do membro (`member`); null para o sistema e a equipe. */
    profileId: uuid('profile_id'),
    /** Quem da equipe publicou (`staff`): `panel:<id>` ou `galaxie:<id>`. */
    staffBy: text('staff_by'),
    /** Texto que passou pela base de regras (#969); null no post automático (o texto sai do modelo, no idioma de quem lê). */
    body: text('body'),
    /** Post automático: o tipo (`kickoff`, `full_time`…) e os dados do jogo. */
    autoKind: text('auto_kind'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    attachmentType: text('attachment_type').$type<CommunityPostAttachment>(),
    attachmentId: uuid('attachment_id'),
    /** Foto só de cargos até a moderação de imagem do Feed (#1025). */
    photoUrl: text('photo_url'),
    visibility: text('visibility').$type<CommunityContentVisibility>().notNull().default('public'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    pinnedBy: text('pinned_by'),
    /** Quem tirou ou devolveu por último (moderação). */
    moderatedBy: text('moderated_by'),
    /** Relógio de conteúdo da ficha do país (#954): depois disso o post é apagado. */
    purgeAt: timestamp('purge_at', { withTimezone: true }).notNull(),
    /** Guarda legal (#1289): denúncia às autoridades ou suspeita de abuso infantil; o expurgo não apaga antes disso. */
    legalHoldUntil: timestamp('legal_hold_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'post_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'post_community_fk',
      columns: [t.tenantId, t.communityId],
      foreignColumns: [communityCommunity.tenantId, communityCommunity.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'post_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    // o Feed é por Comunidade, sem linha do tempo por pessoa: o id (uuid v7) dá a ordem
    index('post_feed_idx').on(t.tenantId, t.communityId, t.id),
    index('post_pinned_idx')
      .on(t.tenantId, t.communityId, t.pinnedAt)
      .where(sql`${t.pinnedAt} is not null`),
    index('post_purge_idx').on(t.purgeAt),
    // um post automático por tipo e jogo em cada Comunidade (repetir a leitura do jogo é inofensivo)
    uniqueIndex('post_auto_uq')
      .on(t.tenantId, t.communityId, t.autoKind, t.attachmentId)
      .where(sql`${t.autoKind} is not null`),
    check('post_author', inList('author', COMMUNITY_POST_AUTHORS)),
    check('post_visibility', inList('visibility', COMMUNITY_CONTENT_VISIBILITY)),
    check(
      'post_attachment',
      sql`(${t.attachmentType} is null and ${t.attachmentId} is null) or (${t.attachmentId} is not null and ${inList('attachment_type', COMMUNITY_POST_ATTACHMENTS)})`,
    ),
    check('post_member_profile', sql`${t.author} <> 'member' or ${t.profileId} is not null`),
    check('post_member_photo', sql`${t.author} = 'staff' or ${t.photoUrl} is null`),
    check('post_content', sql`${t.body} is not null or ${t.autoKind} is not null`),
    check('post_body_len', sql`${t.body} is null or length(${t.body}) between 1 and 5000`),
  ],
);

export const communityComment = community.table(
  'comment',
  {
    tenantId: tenantRef(),
    id: communityId(),
    postId: uuid('post_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    body: text('body').notNull(),
    visibility: text('visibility').$type<CommunityContentVisibility>().notNull().default('public'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    moderatedBy: text('moderated_by'),
    purgeAt: timestamp('purge_at', { withTimezone: true }).notNull(),
    /** Guarda legal (#1289): denúncia às autoridades ou suspeita de abuso infantil; o expurgo não apaga antes disso. */
    legalHoldUntil: timestamp('legal_hold_until', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'comment_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'comment_post_fk',
      columns: [t.tenantId, t.postId],
      foreignColumns: [communityPost.tenantId, communityPost.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'comment_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    index('comment_post_idx').on(t.tenantId, t.postId, t.id),
    index('comment_purge_idx').on(t.purgeAt),
    check('comment_visibility', inList('visibility', COMMUNITY_CONTENT_VISIBILITY)),
    check('comment_body_len', sql`length(${t.body}) between 1 and 2000`),
  ],
);

/** Curtida: uma por Perfil e post. 13 a 17 também curte (reagir não é escrever). */
export const communityReaction = community.table(
  'reaction',
  {
    tenantId: tenantRef(),
    postId: uuid('post_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    kind: text('kind').$type<CommunityReaction>().notNull().default('like'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'reaction_pkey', columns: [t.tenantId, t.postId, t.profileId] }),
    foreignKey({
      name: 'reaction_post_fk',
      columns: [t.tenantId, t.postId],
      foreignColumns: [communityPost.tenantId, communityPost.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reaction_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    check('reaction_kind', inList('kind', COMMUNITY_REACTIONS)),
  ],
);

// ---------------------------------------------------------------- Enquetes (#947)

/**
 * Onde a enquete vive: numa Comunidade (só membros votam) ou na Sala do Jogo do cliente (#915, quem está na sala
 * vota, com ou sem Comunidade). Motor único: a Sala do Jogo usa estas mesmas tabelas (#984).
 */
export const COMMUNITY_POLL_SCOPES = ['community', 'room'] as const;
export type CommunityPollScope = (typeof COMMUNITY_POLL_SCOPES)[number];

/** `free`: pergunta e opções da equipe. `man_of_match`: craque do jogo, opções da escalação do jogo. */
export const COMMUNITY_POLL_KINDS = ['free', 'man_of_match'] as const;
export type CommunityPollKind = (typeof COMMUNITY_POLL_KINDS)[number];

export const communityPoll = community.table(
  'poll',
  {
    tenantId: tenantRef(),
    id: communityId(),
    scope: text('scope').$type<CommunityPollScope>().notNull(),
    /** A Comunidade (`community`); null na Sala do Jogo. */
    communityId: uuid('community_id'),
    /** O jogo: obrigatório na Sala do Jogo e no craque do jogo; opcional na Comunidade (enquete ligada a um jogo). */
    eventId: uuid('event_id'),
    kind: text('kind').$type<CommunityPollKind>().notNull().default('free'),
    /** Pergunta da equipe, já filtrada pela base de regras; null no craque (o texto sai do modelo, no idioma de quem lê). */
    question: text('question'),
    /** Quem criou: `tenant:<prefixo da chave>`, `panel:<id>` ou `galaxie:<id>`. */
    createdBy: text('created_by').notNull(),
    /** Votação aberta até aqui; null = até a equipe fechar. */
    closesAt: timestamp('closes_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'poll_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'poll_community_fk',
      columns: [t.tenantId, t.communityId],
      foreignColumns: [communityCommunity.tenantId, communityCommunity.id],
    }).onDelete('cascade'),
    index('poll_community_idx').on(t.tenantId, t.communityId, t.id),
    index('poll_event_idx').on(t.tenantId, t.eventId, t.id),
    // um craque do jogo por jogo e lugar (repetir o pedido devolve o mesmo)
    uniqueIndex('poll_mom_room_uq')
      .on(t.tenantId, t.eventId)
      .where(sql`${t.kind} = 'man_of_match' and ${t.scope} = 'room'`),
    uniqueIndex('poll_mom_community_uq')
      .on(t.tenantId, t.communityId, t.eventId)
      .where(sql`${t.kind} = 'man_of_match' and ${t.scope} = 'community'`),
    check('poll_scope', inList('scope', COMMUNITY_POLL_SCOPES)),
    check('poll_kind', inList('kind', COMMUNITY_POLL_KINDS)),
    check(
      'poll_scope_target',
      sql`(${t.scope} = 'community' and ${t.communityId} is not null) or (${t.scope} = 'room' and ${t.communityId} is null and ${t.eventId} is not null)`,
    ),
    check('poll_mom_event', sql`${t.kind} <> 'man_of_match' or ${t.eventId} is not null`),
    check('poll_question', sql`${t.kind} = 'man_of_match' or ${t.question} is not null`),
    check('poll_question_len', sql`${t.question} is null or length(${t.question}) between 1 and 200`),
  ],
);

export const communityPollOption = community.table(
  'poll_option',
  {
    tenantId: tenantRef(),
    pollId: uuid('poll_id').notNull(),
    id: communityId(),
    position: integer('position').notNull(),
    /** Texto da opção (`free`), já filtrado; null no craque (o nome vem da pessoa). */
    label: text('label'),
    /** Jogador do craque do jogo (`core.person.id`, sem chave estrangeira). */
    personId: uuid('person_id'),
    /** Time do jogador, para o card. */
    participantId: uuid('participant_id'),
  },
  (t) => [
    primaryKey({ name: 'poll_option_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'poll_option_poll_fk',
      columns: [t.tenantId, t.pollId],
      foreignColumns: [communityPoll.tenantId, communityPoll.id],
    }).onDelete('cascade'),
    uniqueIndex('poll_option_position_uq').on(t.tenantId, t.pollId, t.position),
    check('poll_option_content', sql`${t.label} is not null or ${t.personId} is not null`),
    check('poll_option_label_len', sql`${t.label} is null or length(${t.label}) between 1 and 120`),
    check('poll_option_position', sql`${t.position} between 0 and 59`),
  ],
);

/** Um voto por Perfil e enquete. 13 a 17 também vota (votar não é escrever). */
export const communityPollVote = community.table(
  'poll_vote',
  {
    tenantId: tenantRef(),
    pollId: uuid('poll_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    optionId: uuid('option_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'poll_vote_pkey', columns: [t.tenantId, t.pollId, t.profileId] }),
    foreignKey({
      name: 'poll_vote_poll_fk',
      columns: [t.tenantId, t.pollId],
      foreignColumns: [communityPoll.tenantId, communityPoll.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'poll_vote_option_fk',
      columns: [t.tenantId, t.optionId],
      foreignColumns: [communityPollOption.tenantId, communityPollOption.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'poll_vote_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    index('poll_vote_option_idx').on(t.tenantId, t.pollId, t.optionId),
    // a Gamificação varre os votos recentes para os Pontos de participação
    index('poll_vote_created_idx').on(t.createdAt),
  ],
);
