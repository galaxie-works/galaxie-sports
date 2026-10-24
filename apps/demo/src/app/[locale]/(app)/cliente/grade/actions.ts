'use server';

/**
 * Ações do portal "Grade e ofertas". O tenant sai sempre da sessão (`readClientContext`), nunca do
 * navegador: a operadora só pede revisão de item da grade publicada da própria operadora (ou a inclusão de
 * um canal/streaming num plano dela) e só muda a preferência do próprio tenant; a operadora ligada e os
 * domínios de e-mail ficam com o admin. O banco confere a posse de novo (`forbidden_target`).
 */
import { parseLineupTarget } from '@galaxie/db/lineups';
import { revalidatePath } from 'next/cache';

import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { findOperatorTarget } from '@/lib/lineup/server';
import {
  LineupError,
  createLineupReviewRequest,
  getTenantOperator,
  lineupDb,
  setTenantOperator,
} from '@/lib/lineup/store';
import { MESSAGE_MAX, TARGET_TYPES, isTargetId, parseProposed, type TargetType } from '@/lib/lineup/types';

export interface LineupActionResult {
  ok: boolean;
  error?: string;
}

async function texts() {
  return getDictionary(await getRequestLocale()).lineup.errors;
}

async function tenantOrError() {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx) return { error: t.forbidden } as const;
  if (!ctx.tenant) return { error: t.noTenant } as const;
  return { ctx, tenantId: ctx.tenant.id } as const;
}

export interface ReviewRequestInput {
  targetType: TargetType;
  /** uuid (operadora, plano) ou `<plano>:<canal|streaming>` (vínculo; numa inclusão, ainda não existe). */
  targetId: string;
  message: string;
  proposed?: Record<string, unknown> | null;
}

/** "Solicitar revisão" de um item da grade da operadora do tenant (ou a inclusão de um canal num plano). */
export async function requestLineupReview(input: ReviewRequestInput): Promise<LineupActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!TARGET_TYPES.includes(input?.targetType) || !isTargetId(input.targetType, input.targetId))
    return { ok: false, error: t.notFound };
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) return { ok: false, error: t.messageRequired };
  if (message.length > MESSAGE_MAX) return { ok: false, error: fill(t.messageTooLong, { max: MESSAGE_MAX }) };
  const found = await findOperatorTarget(r.tenantId, input.targetType, input.targetId);
  if (!found) return { ok: false, error: t.notFound };
  const proposed = found.adding
    ? { access: parseProposed(input.targetType, input.proposed)?.access ?? 'included' }
    : parseProposed(input.targetType, input.proposed, found.item?.fields);
  try {
    await createLineupReviewRequest(lineupDb(), {
      tenantId: r.tenantId,
      userId: r.ctx.userId,
      target: parseLineupTarget(input.targetType, input.targetId),
      message,
      proposed,
    });
    revalidatePath('/cliente/grade');
    return { ok: true };
  } catch (err) {
    if (err instanceof LineupError) {
      if (err.code === 'invalid_input') return { ok: false, error: t.invalidProposal };
      if (err.code === 'forbidden_target' || err.code === 'target_not_found')
        return { ok: false, error: t.notFound };
    }
    console.error('[cliente] falha ao criar pedido de revisão da grade', err);
    return { ok: false, error: t.generic };
  }
}

/** Interruptor "Mostrar outras operadoras nas respostas da API" do tenant. */
export async function setShowOtherOperators(value: boolean): Promise<LineupActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  const db = lineupDb();
  const current = await getTenantOperator(db, r.tenantId);
  if (!current?.platformId) return { ok: false, error: t.noOperator };
  try {
    // Só o campo da preferência: a operadora ligada e os domínios ficam como estão.
    await setTenantOperator(db, r.tenantId, { showOtherOperators: value === true });
    revalidatePath('/cliente/grade');
    return { ok: true };
  } catch (err) {
    console.error('[cliente] falha ao salvar a preferência de outras operadoras', err);
    return { ok: false, error: t.generic };
  }
}
