'use server';

/**
 * Ações de Ajustes → Grades e ofertas (só admin): decidir itens da grade (e a mudança que a pesquisa
 * encontrou num item já aprovado), resolver os pedidos das operadoras e ligar cada tenant a uma operadora.
 * Cada uma confere a sessão de admin no servidor (o proxy é só a primeira barreira) e grava quem fez, pelo
 * e-mail do admin.
 */
import { parseLineupTarget } from '@galaxie/db/lineups';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { tenantExists } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import {
  LineupError,
  dismissLineupChange,
  lineupDb,
  resolveLineupReviewRequest,
  setLineupReviewStatus,
  setTenantOperator,
} from '@/lib/lineup/store';
import {
  DOMAINS_MAX,
  NOTE_MAX,
  REVIEW_STATUSES,
  TARGET_TYPES,
  isId,
  isTargetId,
  parseDomains,
  type LineupStatus,
  type TargetType,
} from '@/lib/lineup/types';

export interface AdminLineupResult {
  ok: boolean;
  error?: string;
}

async function texts() {
  return getDictionary(await getRequestLocale()).lineup.errors;
}

const revalidate = () => {
  revalidatePath('/ajustes/grades');
  revalidatePath('/cliente/grade');
};

const validTarget = (target: { type: TargetType; id: string } | undefined) =>
  Boolean(target && TARGET_TYPES.includes(target.type) && isTargetId(target.type, target.id));

/**
 * Aprovar, marcar como conferido, voltar para rascunho ou rejeitar um item da grade. Aprovar um item com
 * mudança encontrada pela pesquisa aplica a mudança.
 */
export async function decideLineupItem(
  target: { type: TargetType; id: string },
  status: LineupStatus,
): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!validTarget(target) || !REVIEW_STATUSES.includes(status)) return { ok: false, error: t.itemNotFound };
  if (!(await setLineupReviewStatus(lineupDb(), parseLineupTarget(target.type, target.id), status, me.email)))
    return { ok: false, error: t.itemNotFound };
  revalidate();
  return { ok: true };
}

/** Descartar a mudança que a pesquisa encontrou num item já aprovado (o dado aprovado fica). */
export async function dismissLineupItemChange(target: {
  type: TargetType;
  id: string;
}): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!validTarget(target)) return { ok: false, error: t.itemNotFound };
  if (!(await dismissLineupChange(lineupDb(), parseLineupTarget(target.type, target.id), me.email)))
    return { ok: false, error: t.itemNotFound };
  revalidate();
  return { ok: true };
}

/**
 * Aceitar (aplicando ou não a correção proposta) ou recusar um pedido de revisão de uma operadora.
 * Recusar exige nota: é a resposta que a operadora lê no portal.
 */
export async function resolveLineupRequest(
  requestId: string,
  input: { status: 'accepted' | 'rejected'; note?: string | null; apply?: boolean },
): Promise<AdminLineupResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!isId(requestId) || (input?.status !== 'accepted' && input?.status !== 'rejected'))
    return { ok: false, error: t.requestNotFound };
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > NOTE_MAX) return { ok: false, error: fill(t.noteTooLong, { max: NOTE_MAX }) };
  if (input.status === 'rejected' && !note) return { ok: false, error: t.noteRequired };
  try {
    await resolveLineupReviewRequest(lineupDb(), requestId, {
      status: input.status,
      note: note || null,
      by: me.email,
      apply: input.status === 'accepted' && input.apply === true,
    });
  } catch (err) {
    if (err instanceof LineupError) {
      if (err.code === 'target_not_found') return { ok: false, error: t.itemNotFound };
      if (err.code === 'invalid_input') return { ok: false, error: t.invalidProposal };
      return { ok: false, error: t.requestNotFound };
    }
    throw err;
  }
  revalidate();
  return { ok: true };
}

/** Cadastro do tenant: operadora ligada, domínios de e-mail e a preferência de outras operadoras. */
export async function saveTenantOperator(
  tenantId: string,
  input: { platformId: string | null; domains: string; showOtherOperators: boolean },
): Promise<AdminLineupResult> {
  await requireAdmin();
  const t = await texts();
  if (!isId(tenantId) || !(await tenantExists(tenantId))) return { ok: false, error: t.tenantNotFound };
  const platformId = input?.platformId ?? null;
  if (platformId !== null && !isId(platformId)) return { ok: false, error: t.platformNotFound };
  const { domains, invalid } = parseDomains(typeof input.domains === 'string' ? input.domains : '');
  if (invalid.length) return { ok: false, error: fill(t.domains, { list: invalid.join(', ') }) };
  if (domains.length > DOMAINS_MAX) return { ok: false, error: fill(t.tooManyDomains, { max: DOMAINS_MAX }) };
  try {
    const saved = await setTenantOperator(lineupDb(), tenantId, {
      platformId,
      emailDomains: domains,
      showOtherOperators: input.showOtherOperators === true,
    });
    if (!saved) return { ok: false, error: t.tenantNotFound };
  } catch (err) {
    if (err instanceof LineupError) return { ok: false, error: t.platformNotFound };
    console.error('[ajustes] falha ao ligar o tenant à operadora', err);
    return { ok: false, error: t.generic };
  }
  revalidate();
  revalidatePath('/ajustes/usuarios');
  return { ok: true };
}
