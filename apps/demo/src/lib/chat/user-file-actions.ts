'use server';

/**
 * Nota interna na ficha do torcedor (#973). O tenant e o cargo saem da sessão; a nota sai no relógio de decisões da
 * ficha do país do torcedor, como a auditoria.
 */
import { addModerationNote } from '@galaxie/db/moderation-queue';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';
import { allowed } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { clocksFor, NoPolicyError } from '@/lib/moderation/clocks';

import type { ChatActionResult } from './panel-actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 1_000;

export async function addNoteAction(input: { profileId: string; body: string }): Promise<ChatActionResult> {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const D = getDictionary(locale).chatPanel;
  const T = D.errors;
  if (!ctx?.tenant || !ctx.actor) return { ok: false, error: T.forbidden };
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!UUID.test(input.profileId) || !body) return { ok: false, error: T.invalid };
  if ([...body].length > NOTE_MAX) return { ok: false, error: D.userFile.noteTooLong };
  // a ficha é do tenant inteiro: cargo com escopo de sala não anota
  if (!ctx.tenant.modules.includes('live_chat') || !allowed(ctx, 'moderation.hide').ok)
    return { ok: false, error: T.role };
  const profile = await pool.query(`select 1 from fan.profile where tenant_id = $1 and id = $2`, [
    ctx.tenant.id,
    input.profileId,
  ]);
  if (!profile.rowCount) return { ok: false, error: T.notFound };
  let clocks;
  try {
    clocks = await clocksFor(ctx.tenant.id, input.profileId);
  } catch (err) {
    if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
    throw err;
  }
  await addModerationNote(builderDb(), {
    tenantId: ctx.tenant.id,
    profileId: input.profileId.toLowerCase(),
    body,
    author: ctx.actor.kind === 'galaxie_staff' ? `galaxie:${ctx.userId}` : `user:${ctx.userId}`,
    purgeAt: clocks.decisionPurgeAt,
  });
  return { ok: true };
}
