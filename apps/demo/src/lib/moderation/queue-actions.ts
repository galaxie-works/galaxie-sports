'use server';

/**
 * Decisões da equipe na fila de revisão (#999): publicar, remover, desfazer a decisão automática, silenciar,
 * suspender e banir. O tenant e o cargo saem da sessão, nunca do navegador; cada decisão confere o cargo (#1019) na
 * sala ou comunidade do caso, e tudo entra na auditoria da base com os relógios da ficha do país (D5).
 */
import {
  applySanction,
  closeCase,
  readCase,
  undoDecision,
  type ModerationActor,
} from '@galaxie/db/moderation-queue';
import { SANCTION_SCOPE, checkSanction } from '@galaxie/engage';

import { builderDb } from '@/lib/builder/store';
import { allowed } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

import { clocksFor, NoPolicyError } from './clocks';
import { loadDecisions, type DecisionItem } from './queue-data';
import { MUTE_HOURS, SUSPEND_DAYS, decisionAction, isQueueDecision, type QueueDecision } from './queue-utils';

export interface QueueActionResult {
  ok: boolean;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 500;

async function session() {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const T = getDictionary(locale).moderation.queue.errors;
  if (!ctx?.tenant || !ctx.actor) return { error: T.forbidden } as const;
  const actor: ModerationActor =
    ctx.actor.kind === 'galaxie_staff'
      ? { id: `galaxie:${ctx.userId}`, kind: 'galaxie' }
      : { id: `user:${ctx.userId}`, kind: 'person' };
  return { ctx: { ...ctx, tenant: ctx.tenant }, actor, T } as const;
}

export async function decideCase(input: {
  caseId: string;
  decision: QueueDecision;
  /** Silenciar (horas) e suspender (dias). */
  duration?: number;
  note?: string;
}): Promise<QueueActionResult> {
  const s = await session();
  if ('error' in s) return { ok: false, error: s.error };
  const { ctx, actor, T } = s;
  if (!UUID.test(input.caseId) || !isQueueDecision(input.decision)) return { ok: false, error: T.invalid };
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, NOTE_MAX) || null : null;
  const db = builderDb();
  const c = await readCase(db, ctx.tenant.id, input.caseId);
  if (!c) return { ok: false, error: T.notFound };

  const hours =
    input.decision === 'mute'
      ? (MUTE_HOURS as readonly number[]).includes(input.duration ?? -1)
        ? input.duration!
        : null
      : input.decision === 'suspend'
        ? (SUSPEND_DAYS as readonly number[]).includes(input.duration ?? -1)
          ? input.duration! * 24
          : null
        : 0;
  if (hours === null) return { ok: false, error: T.invalid };

  // o cargo vale no lugar do caso (escopo do moderador) e, no silêncio, com o teto de duração do cargo
  const gate = allowed(ctx, decisionAction(input.decision), {
    ...(c.community ? { community: c.community } : {}),
    ...(c.room ? { room: c.room } : {}),
    ...(input.decision === 'mute' ? { durationSec: hours * 3600 } : {}),
  });
  if (!gate.ok) return { ok: false, error: T.role };

  const now = new Date();
  let clocks;
  try {
    clocks = await clocksFor(ctx.tenant.id, c.targetProfileId, now);
  } catch (err) {
    if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
    throw err;
  }

  try {
    if (input.decision === 'undo') {
      const r = await undoDecision(db, { tenantId: ctx.tenant.id, caseId: c.id, actor, note, clocks, now });
      return r.ok
        ? { ok: true }
        : { ok: false, error: r.reason === 'not_found' ? T.notFound : T.notAutomatic };
    }
    if (c.status !== 'open') return { ok: false, error: T.closed };
    if (c.source === 'appeal') return { ok: false, error: T.appeal };
    if (input.decision === 'approve') {
      const done = await closeCase(db, {
        tenantId: ctx.tenant.id,
        caseId: c.id,
        status: 'dismissed',
        actor,
        note,
        clocks,
        now,
      });
      return done ? { ok: true } : { ok: false, error: T.closed };
    }
    if (input.decision !== 'remove') {
      if (!c.targetProfileId) return { ok: false, error: T.noAuthor };
      const level = input.decision === 'mute' ? 'mute' : input.decision === 'suspend' ? 'suspension' : 'ban';
      const scope = SANCTION_SCOPE[level];
      const place = c.room ?? c.community;
      if (scope === 'place' && !place) return { ok: false, error: T.noPlace };
      const endsAt = level === 'ban' ? null : new Date(now.getTime() + hours * 3600_000);
      const problems = checkSanction(
        {
          level,
          hidden: false,
          decidedBy: 'person',
          endsAt: endsAt?.getTime() ?? null,
          scopeId: scope === 'place' ? place : null,
        },
        { now: now.getTime(), hiddenEnabled: false, policy: null },
      );
      if (problems.length) return { ok: false, error: T.invalid };
      await applySanction(db, {
        tenantId: ctx.tenant.id,
        profileId: c.targetProfileId,
        accountId: null,
        level,
        hidden: false,
        scope,
        scopeId: scope === 'place' ? place : null,
        reason: note ?? (c.reasons.join(', ') || level),
        caseId: c.id,
        actor,
        endsAt,
        clocks,
        rules: { from: 'queue' },
        now,
      });
    }
    // remover e punir tiram o conteúdo do ar e fecham o caso
    await closeCase(db, {
      tenantId: ctx.tenant.id,
      caseId: c.id,
      status: 'resolved',
      actor,
      note,
      clocks,
      hide: true,
      now,
    });
    return { ok: true };
  } catch (err) {
    console.error('[moderação] decisão da fila falhou', { tenantId: ctx.tenant.id, caseId: c.id, err });
    return { ok: false, error: T.generic };
  }
}

/** Próxima página do histórico, com os mesmos filtros. Sem o cargo, nada volta. */
export async function moreDecisions(input: {
  before: string;
  module?: string;
  category?: string;
  action?: string;
  actorKind?: string;
}): Promise<{ items: DecisionItem[]; next: string | null } | null> {
  const s = await session();
  if ('error' in s) return null;
  if (!allowed(s.ctx, 'audit.view').ok || !UUID.test(input.before)) return null;
  return loadDecisions(s.ctx.tenant.id, {
    before: input.before,
    ...(input.module ? { module: input.module } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.actorKind ? { actorKind: input.actorKind } : {}),
  });
}
