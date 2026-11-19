'use server';

/**
 * Nota interna na ficha do torcedor (#973). O tenant e o cargo saem da sessão; a nota sai no relógio de decisões da
 * ficha do país do torcedor, como a auditoria.
 */
import { addModerationNote, recordModerationDecision } from '@galaxie/db/moderation-queue';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';
import { allowed } from '@/lib/client/permissions';
import { withStaffAudit } from '@/lib/client/staff';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { clocksFor, NoPolicyError } from '@/lib/moderation/clocks';

import { hasLiveChat } from './access';
import type { ChatActionResult } from './panel-actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 1_000;

export const addNoteAction = withStaffAudit(
  'chat.user_file.note',
  async function addNoteAction(input: { profileId: string; body: string }): Promise<ChatActionResult> {
    const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
    const D = getDictionary(locale).chatPanel;
    const T = D.errors;
    if (!ctx?.tenant || !ctx.actor) return { ok: false, error: T.forbidden };
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!UUID.test(input.profileId) || !body) return { ok: false, error: T.invalid };
    if ([...body].length > NOTE_MAX) return { ok: false, error: D.userFile.noteTooLong };
    // a ficha é do tenant inteiro: cargo com escopo de sala não anota
    if (!hasLiveChat({ role: ctx.role, tenant: ctx.tenant }) || !allowed(ctx, 'moderation.hide').ok)
      return { ok: false, error: T.role };
    const profile = await pool.query(
      `select 1 from fan.profile where tenant_id = $1 and id = $2 and deleted_at is null`,
      [ctx.tenant.id, input.profileId],
    );
    if (!profile.rowCount) return { ok: false, error: T.notFound };
    let clocks;
    try {
      clocks = await clocksFor(ctx.tenant.id, input.profileId);
    } catch (err) {
      if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
      throw err;
    }
    const galaxie = ctx.actor.kind === 'galaxie_staff';
    const tenantId = ctx.tenant.id;
    const author = galaxie ? `galaxie:${ctx.userId}` : `user:${ctx.userId}`;
    const profileId = input.profileId.toLowerCase();
    const db = builderDb();
    // a nota e a auditoria (sem o texto, que fica só na ficha) entram juntas
    const id = await db.transaction(async (tx) => {
      const noteId = await addModerationNote(tx, {
        tenantId,
        profileId,
        body,
        author,
        purgeAt: clocks.decisionPurgeAt,
      });
      if (!noteId) return null;
      await recordModerationDecision(tx as unknown as typeof db, {
        tenantId,
        actor: { id: author, kind: galaxie ? 'galaxie' : 'person' },
        action: 'note.add',
        clocks,
        subjectProfileId: profileId,
        reason: 'note.add',
        rules: { note: noteId },
      });
      return noteId;
    });
    // excluído entre a checagem e a gravação
    if (!id) return { ok: false, error: T.notFound };
    return { ok: true };
  },
);
