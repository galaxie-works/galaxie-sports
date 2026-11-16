'use server';

/**
 * Ações da equipe Galaxie em Ajustes › Organizações e marcas (#1136, F2): faixa de capacidade, revisão do cadastro e
 * cliente zero, sempre com motivo, registradas em `billing.staff_action` com o antes e o depois. Só a equipe
 * (`requireAdmin`: admin e support). Nada de preço.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import {
  CAPACITY_TIERS,
  REVIEW_STATUSES,
  updateOrganization,
  type CapacityTier,
  type ReviewStatus,
} from '@/lib/client/organizations';
import { normalizeStaffReason } from '@/lib/client/staff-reason';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface OrganizationActionResult {
  ok: boolean;
  error?: string;
}

const PATH = '/settings/organizations';

export async function updateOrganizationAction(input: {
  id: string;
  capacityTier?: string;
  reviewStatus?: string;
  isGalaxie?: boolean;
  reason: string;
}): Promise<OrganizationActionResult> {
  const me = await requireAdmin();
  const e = getDictionary(await getRequestLocale()).platformStaff.errors;
  if (!isUuid(input?.id)) return { ok: false, error: e.notFound };
  const reason = normalizeStaffReason(input.reason);
  if (!reason) return { ok: false, error: e.reason };
  const patch: { capacityTier?: CapacityTier; reviewStatus?: ReviewStatus; isGalaxie?: boolean } = {};
  if (input.capacityTier !== undefined) {
    if (!(CAPACITY_TIERS as readonly string[]).includes(input.capacityTier)) return { ok: false, error: e.invalid };
    patch.capacityTier = input.capacityTier as CapacityTier;
  }
  if (input.reviewStatus !== undefined) {
    if (!(REVIEW_STATUSES as readonly string[]).includes(input.reviewStatus)) return { ok: false, error: e.invalid };
    patch.reviewStatus = input.reviewStatus as ReviewStatus;
  }
  if (input.isGalaxie !== undefined) patch.isGalaxie = input.isGalaxie === true;
  try {
    const changed = await updateOrganization({ id: input.id, patch, actor: me.id, reason });
    if (!changed) return { ok: false, error: e.unchanged };
  } catch (err) {
    console.error('[organizações] ação da equipe falhou', err);
    return { ok: false, error: e.generic };
  }
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${input.id}`);
  return { ok: true };
}
