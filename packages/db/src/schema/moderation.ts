/**
 * Fila única da moderação (#953, B8), no schema `engage`. As regras ficam em `@galaxie/engage` (`moderation-queue`).
 *
 * - `moderation_case`: a fila. Denúncia, conteúdo segurado pelo filtro (B7), sugestão da Cosmos e apelação, um caso
 *   aberto por conteúdo. Guarda o conteúdo original até o relógio de conteúdo removido da ficha do país (D5).
 * - `moderation_report`: cada denúncia; um torcedor denuncia o mesmo conteúdo uma vez só.
 * - `fan_block`: bloqueio de torcedor a torcedor (Apple 1.2, Google Play).
 * - `moderation_sanction`: a Escada aplicada a um Perfil (ou estendida à Conta).
 * - `moderation_appeal`: uma apelação por punição e etapa.
 * - `moderation_audit`: registro imutável. Um gatilho recusa UPDATE, DELETE e TRUNCATE; só o expurgo por relógio
 *   (`engage.moderation_purge = on` na transação, e só o que venceu) e a exclusão do torcedor
 *   (`engage.moderation_erasure = on`, só apagar o conteúdo) passam.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { engage } from './engage.js';
import { fanProfile } from './fan.js';

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' });

const inList = (col: unknown, list: readonly string[]) =>
  sql`${col} in (${sql.raw(list.map((v) => `'${v}'`).join(', '))})`;

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const MODERATION_TARGETS = [
  'message',
  'comment',
  'post',
  'profile',
  'community_name',
  'league_name',
  'behavior',
] as const;
export const MODERATION_REASONS = [
  'hate',
  'harassment',
  'threat',
  'sexual',
  'spam',
  'betting',
  'personal_data',
  'other',
] as const;
export const MODERATION_SOURCES = ['report', 'filter', 'cosmos', 'appeal'] as const;
export const MODERATION_CASE_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export const MODERATION_MODULES = ['chat', 'communities', 'gamification', 'shopping', 'profile'] as const;
export const MODERATION_LEVELS = ['warning', 'mute', 'suspension', 'expulsion', 'ban'] as const;
export const MODERATION_SCOPES = ['place', 'community', 'tenant'] as const;
export const MODERATION_DECIDERS = ['person', 'cosmos', 'galaxie', 'system'] as const;
export const MODERATION_APPEAL_STATUSES = ['pending', 'upheld', 'overturned'] as const;

export const moderationCase = engage.table(
  'moderation_case',
  {
    id: pkUuidV7(),
    tenantId: tenantRef(),
    source: text('source').notNull(),
    targetType: text('target_type').notNull(),
    /** Id do conteúdo no módulo (mensagem, post...) ou do Perfil. */
    targetId: text('target_id').notNull(),
    /** Autor do conteúdo (ou o Perfil denunciado). */
    targetProfileId: uuid('target_profile_id'),
    module: text('module').notNull(),
    room: text('room'),
    community: text('community'),
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    severity: integer('severity').notNull(),
    reportCount: integer('report_count').notNull().default(0),
    status: text('status').notNull().default('open'),
    /** Oculto até a revisão (N denúncias ou filtro). */
    hiddenAt: ts('hidden_at'),
    /** Conteúdo original, para a revisão e a auditoria. Sai no relógio de conteúdo removido. */
    content: text('content'),
    contentPurgeAt: ts('content_purge_at'),
    /** O que o filtro ou a Cosmos disseram (categorias, nota). Nunca dado pessoal. */
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    /** Apelação: a punição apelada. */
    sanctionId: uuid('sanction_id'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: text('resolved_by'),
    /** Relógio de decisões: o caso resolvido sai do banco depois disso. */
    purgeAt: ts('purge_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('moderation_case_tenant_id_uq').on(t.tenantId, t.id),
    // um caso aberto por conteúdo: a denúncia, o filtro e a Cosmos somam no mesmo
    uniqueIndex('moderation_case_open_target_uq')
      .on(t.tenantId, t.targetType, t.targetId)
      .where(sql`${t.status} = 'open' and ${t.source} <> 'appeal'`),
    index('moderation_case_queue_idx').on(t.tenantId, t.status, t.severity.desc(), t.createdAt),
    index('moderation_case_purge_idx').on(t.purgeAt),
    check('moderation_case_source', inList(t.source, MODERATION_SOURCES)),
    check('moderation_case_target', inList(t.targetType, MODERATION_TARGETS)),
    check('moderation_case_module', inList(t.module, MODERATION_MODULES)),
    check('moderation_case_status', inList(t.status, MODERATION_CASE_STATUSES)),
    check('moderation_case_target_id', sql`length(${t.targetId}) between 1 and 200`),
    check('moderation_case_content', sql`${t.content} is null or length(${t.content}) <= 10000`),
    check('moderation_case_appeal', sql`(${t.source} = 'appeal') = (${t.sanctionId} is not null)`),
  ],
);

export const moderationReport = engage.table(
  'moderation_report',
  {
    id: pkUuidV7(),
    tenantId: tenantRef(),
    caseId: uuid('case_id').notNull(),
    reporterProfileId: uuid('reporter_profile_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'moderation_report_case_fk',
      columns: [t.tenantId, t.caseId],
      foreignColumns: [moderationCase.tenantId, moderationCase.id],
    }).onDelete('cascade'),
    uniqueIndex('moderation_report_once_uq').on(t.tenantId, t.targetType, t.targetId, t.reporterProfileId),
    index('moderation_report_reporter_idx').on(t.tenantId, t.reporterProfileId, t.createdAt),
    index('moderation_report_case_idx').on(t.tenantId, t.caseId),
    check('moderation_report_reason', inList(t.reason, MODERATION_REASONS)),
    check('moderation_report_note', sql`${t.note} is null or length(${t.note}) <= 500`),
  ],
);

export const fanBlock = engage.table(
  'fan_block',
  {
    tenantId: tenantRef(),
    blockerProfileId: uuid('blocker_profile_id').notNull(),
    blockedProfileId: uuid('blocked_profile_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'fan_block_pkey', columns: [t.tenantId, t.blockerProfileId, t.blockedProfileId] }),
    foreignKey({
      name: 'fan_block_blocker_fk',
      columns: [t.tenantId, t.blockerProfileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fan_block_blocked_fk',
      columns: [t.tenantId, t.blockedProfileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    index('fan_block_blocked_idx').on(t.tenantId, t.blockedProfileId),
    check('fan_block_self', sql`${t.blockerProfileId} <> ${t.blockedProfileId}`),
  ],
);

export const moderationSanction = engage.table(
  'moderation_sanction',
  {
    id: pkUuidV7(),
    tenantId: tenantRef(),
    profileId: uuid('profile_id').notNull(),
    /** Estendida à Conta (abuso continuou em outro Perfil): vale para todos os Perfis da Conta. */
    accountId: uuid('account_id'),
    level: text('level').notNull(),
    /** Silêncio oculto. */
    hidden: boolean('hidden').notNull().default(false),
    scope: text('scope').notNull(),
    scopeId: text('scope_id'),
    reason: text('reason').notNull(),
    caseId: uuid('case_id'),
    decidedBy: text('decided_by').notNull(),
    decidedByKind: text('decided_by_kind').notNull(),
    startsAt: ts('starts_at').notNull().defaultNow(),
    endsAt: ts('ends_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: text('revoked_by'),
    purgeAt: ts('purge_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('moderation_sanction_tenant_id_uq').on(t.tenantId, t.id),
    index('moderation_sanction_profile_idx').on(t.tenantId, t.profileId),
    index('moderation_sanction_account_idx')
      .on(t.tenantId, t.accountId)
      .where(sql`${t.accountId} is not null`),
    check('moderation_sanction_level', inList(t.level, MODERATION_LEVELS)),
    check('moderation_sanction_scope', inList(t.scope, MODERATION_SCOPES)),
    check('moderation_sanction_decider', inList(t.decidedByKind, MODERATION_DECIDERS)),
    check(
      'moderation_sanction_hidden',
      sql`not ${t.hidden} or (${t.level} = 'mute' and ${t.endsAt} is not null)`,
    ),
    check('moderation_sanction_hidden_person', sql`not ${t.hidden} or ${t.decidedByKind} = 'person'`),
    check('moderation_sanction_reason', sql`length(${t.reason}) between 1 and 500`),
    check('moderation_sanction_dates', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
);

export const moderationAppeal = engage.table(
  'moderation_appeal',
  {
    id: pkUuidV7(),
    tenantId: tenantRef(),
    sanctionId: uuid('sanction_id').notNull(),
    stage: smallint('stage').notNull(),
    statement: text('statement'),
    status: text('status').notNull().default('pending'),
    /** `team` (equipe do cliente) ou `galaxie` (fila de segunda apelação da Galaxie). */
    route: text('route').notNull(),
    dueAt: ts('due_at').notNull(),
    caseId: uuid('case_id'),
    decidedBy: text('decided_by'),
    decidedByKind: text('decided_by_kind'),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'moderation_appeal_sanction_fk',
      columns: [t.tenantId, t.sanctionId],
      foreignColumns: [moderationSanction.tenantId, moderationSanction.id],
    }).onDelete('cascade'),
    uniqueIndex('moderation_appeal_stage_uq').on(t.tenantId, t.sanctionId, t.stage),
    index('moderation_appeal_galaxie_idx')
      .on(t.dueAt)
      .where(sql`${t.route} = 'galaxie' and ${t.status} = 'pending'`),
    check('moderation_appeal_stage', sql`${t.stage} in (1, 2)`),
    check('moderation_appeal_status', inList(t.status, MODERATION_APPEAL_STATUSES)),
    check('moderation_appeal_route', sql`${t.route} in ('team', 'galaxie')`),
    check(
      'moderation_appeal_second_person',
      sql`${t.stage} = 1 or ${t.decidedByKind} is distinct from 'cosmos'`,
    ),
    check('moderation_appeal_statement', sql`${t.statement} is null or length(${t.statement}) <= 1000`),
    check(
      'moderation_appeal_decided',
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null) and (${t.status} = 'pending') = (${t.decidedBy} is null)`,
    ),
  ],
);

export const moderationAudit = engage.table(
  'moderation_audit',
  {
    id: pkUuidV7(),
    tenantId: tenantRef(),
    /** `user:<id>`, `cosmos`, `galaxie:<id>`, `fan:<perfil>` ou `system`. */
    actor: text('actor').notNull(),
    actorKind: text('actor_kind').notNull(),
    /** `report`, `hide`, `sanction`, `revoke`, `appeal`, `appeal.decide`, `case.resolve`, `case.dismiss`... */
    action: text('action').notNull(),
    subjectProfileId: uuid('subject_profile_id'),
    caseId: uuid('case_id'),
    sanctionId: uuid('sanction_id'),
    appealId: uuid('appeal_id'),
    reason: text('reason'),
    /** Régua vigente na hora (limite de ocultar, ficha do país, versão das listas). */
    rules: jsonb('rules').$type<Record<string, unknown>>(),
    /** Conteúdo original. Sai no relógio de conteúdo removido ou na exclusão do torcedor. */
    content: text('content'),
    contentPurgeAt: ts('content_purge_at'),
    /** Relógio de decisões: a linha sai depois disso. */
    purgeAt: ts('purge_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderation_audit_tenant_idx').on(t.tenantId, t.createdAt),
    index('moderation_audit_subject_idx').on(t.tenantId, t.subjectProfileId),
    index('moderation_audit_purge_idx').on(t.purgeAt),
    check('moderation_audit_actor_kind', inList(t.actorKind, [...MODERATION_DECIDERS, 'fan'])),
    check('moderation_audit_action', sql`length(${t.action}) between 1 and 40`),
  ],
);
