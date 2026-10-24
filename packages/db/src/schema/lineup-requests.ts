import { index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkUuidV7 } from './_shared.js';
import { tenant } from './api.js';
import { ops } from './ops.js';

/** O que um pedido de revisão da grade aponta. */
export const LINEUP_TARGET_TYPES = ['platform', 'plan', 'plan_channel', 'plan_service', 'addon'] as const;
export type LineupTargetType = (typeof LINEUP_TARGET_TYPES)[number];

export const LINEUP_REQUEST_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type LineupRequestStatus = (typeof LINEUP_REQUEST_STATUSES)[number];

/**
 * Pedido de revisão da grade feito pela operadora cliente no portal. Ela não edita a grade: o pedido
 * vai para o painel e, aceito com `apply`, o `proposed` vira dado oficial com a fonte "informado pela
 * operadora".
 */
export const lineupReviewRequest = ops.table(
  'lineup_review_request',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Usuário do portal (id do Better Auth). */
    userId: text('user_id').notNull(),
    targetType: text('target_type').$type<LineupTargetType>().notNull(),
    /** uuid da plataforma/plano; `<plan_id>:<channel_id>` ou `<plan_id>:<service_id>` nos vínculos. */
    targetId: text('target_id').notNull(),
    message: text('message').notNull(),
    /** Campos propostos (ver `LineupProposal` em lineups.ts). */
    proposed: jsonb('proposed').$type<Record<string, unknown>>(),
    status: text('status').$type<LineupRequestStatus>().notNull().default('open'),
    resolutionNote: text('resolution_note'),
    resolvedBy: text('resolved_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('lineup_review_request_tenant_idx').on(t.tenantId, t.status, t.createdAt),
    index('lineup_review_request_status_idx').on(t.status, t.createdAt),
    index('lineup_review_request_target_idx').on(t.targetType, t.targetId),
  ],
);
