'use server';

/**
 * Ações dos domínios comprovados por TXT (#1136, F2). O tenant sai sempre da sessão (`readClientContext`), nunca do
 * navegador: cada função de `lib/client/domains` filtra pela marca, então um id de outra marca não acha nada. Quem
 * integra (`domains.manage`: Dono, Admin e Desenvolvedor) cadastra, pede a conferência e remove.
 */
import { revalidatePath } from 'next/cache';

import { isStaffRole } from '@/lib/auth/roles';
import { addDomain, DomainError, removeDomain, requestDomainVerification } from '@/lib/client/domains';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { withStaffAudit } from '@/lib/client/staff';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface DomainActionResult {
  ok: boolean;
  error?: string;
  /** Pedido de conferência: já havia um na fila. */
  queued?: boolean;
}

const PATH = '/client/domains';

async function texts() {
  const dict = getDictionary(await getRequestLocale());
  return { d: dict.client.domains, client: dict.client };
}

async function tenantOrError() {
  const ctx = await readClientContext();
  const { d, client } = await texts();
  if (!ctx) return { d, error: client.errors.forbidden } as const;
  if (!ctx.tenant) return { d, error: client.errors.noTenant } as const;
  if (!can(ctx, 'domains.manage')) return { d, error: client.errors.role } as const;
  const actor = isStaffRole(ctx.role) ? `galaxie:${ctx.userId}` : `panel:${ctx.userId}`;
  return { d, tenant: ctx.tenant, actor } as const;
}

function failure(err: unknown, d: Awaited<ReturnType<typeof texts>>['d']): DomainActionResult {
  if (err instanceof DomainError) {
    if (err.code === 'limit') return { ok: false, error: fill(d.errors.limit, { max: 20 }) };
    return { ok: false, error: d.errors[err.code] };
  }
  console.error('[domínios] ação do painel falhou', err);
  return { ok: false, error: d.errors.generic };
}

/** Cadastra um host na marca (minúsculas; o navegador pode mandar com esquema, que é cortado). */
export const addDomainAction = withStaffAudit('domains.add', async (input: {
  host: string;
}): Promise<DomainActionResult> => {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  try {
    await addDomain({ tenantId: r.tenant.id, host: input?.host, actor: r.actor });
  } catch (err) {
    return failure(err, r.d);
  }
  revalidatePath(PATH);
  return { ok: true };
});

/** Pede a conferência do TXT (tarefa do worker; uma por domínio na fila). */
export const verifyDomainAction = withStaffAudit('domains.verify', async (input: {
  id: string;
}): Promise<DomainActionResult> => {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  const res = await requestDomainVerification(r.tenant.id, String(input?.id ?? ''), r.actor);
  if (!res) return { ok: false, error: r.d.errors.notFound };
  revalidatePath(PATH);
  return { ok: true, queued: !res.created };
});

/** Remove o domínio da marca (comprovado ou não). */
export const removeDomainAction = withStaffAudit('domains.remove', async (input: {
  id: string;
}): Promise<DomainActionResult> => {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!(await removeDomain(r.tenant.id, String(input?.id ?? '')))) return { ok: false, error: r.d.errors.notFound };
  revalidatePath(PATH);
  return { ok: true };
});
