'use server';

/**
 * Ações da equipe Galaxie nas Carteiras da Cosmos (#1002): só admin (`requireAdmin`), sempre com motivo, e cada uma
 * registrada com quem fez. Ajuste e estorno vão para o extrato; multiplicador, bloqueio e pacote, para
 * `cosmos.staff_action`.
 */
import {
  isCosmosError,
  staffCredit,
  staffSavePackage,
  staffSetBlocked,
  staffSetMultiplier,
  STAFF_REASON_MIN,
} from '@galaxie/cosmos';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { builderDb } from '@/lib/builder/store';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface StaffActionResult {
  ok: boolean;
  error?: string;
}

const PATH = '/ajustes/carteiras';

async function texts() {
  return getDictionary(await getRequestLocale()).cosmosStaff.actions.errors;
}

async function run(tenantId: string | null, reason: string, fn: (userId: string) => Promise<unknown>) {
  const me = await requireAdmin();
  const e = await texts();
  if (tenantId !== null && !isUuid(tenantId)) return { ok: false, error: e.generic };
  if (reason.trim().length < STAFF_REASON_MIN) return { ok: false, error: e.reason };
  try {
    await fn(me.id);
  } catch (err) {
    if (isCosmosError(err, 'reason_required')) return { ok: false, error: e.reason };
    if (isCosmosError(err, 'invalid_amount')) return { ok: false, error: e.amount };
    if (isCosmosError(err, 'insufficient_credits')) return { ok: false, error: e.insufficient };
    console.error('[cosmos] ação da equipe falhou', err);
    return { ok: false, error: e.generic };
  }
  revalidatePath(PATH);
  if (tenantId) revalidatePath(`${PATH}/${tenantId}`);
  return { ok: true };
}

/**
 * Ajuste (positivo ou negativo) ou estorno de créditos. `requestKey` nasce no navegador ao abrir a janela: reenviar
 * o mesmo formulário (clique duplo, nova tentativa) devolve o lançamento já feito em vez de lançar de novo.
 */
export async function creditWallet(input: {
  tenantId: string;
  kind: 'adjustment' | 'refund';
  credits: number;
  reason: string;
  requestKey: string;
}): Promise<StaffActionResult> {
  const credits = Number(input.credits);
  if (!Number.isFinite(credits) || credits === 0 || (input.kind === 'refund' && credits < 0))
    return { ok: false, error: (await texts()).amount };
  if (!isUuid(input.requestKey)) return { ok: false, error: (await texts()).generic };
  return run(input.tenantId, input.reason, (userId) =>
    staffCredit(builderDb(), {
      tenantId: input.tenantId,
      kind: input.kind,
      credits,
      reason: input.reason,
      userId,
      requestKey: input.requestKey,
    }),
  );
}

export async function setMultiplier(input: {
  tenantId: string;
  multiplier: number;
  reason: string;
}): Promise<StaffActionResult> {
  return run(input.tenantId, input.reason, (userId) =>
    staffSetMultiplier(builderDb(), {
      tenantId: input.tenantId,
      multiplier: Number(input.multiplier),
      reason: input.reason,
      userId,
    }),
  );
}

export async function setBlocked(input: {
  tenantId: string;
  blocked: boolean;
  reason: string;
}): Promise<StaffActionResult> {
  return run(input.tenantId, input.reason, (userId) =>
    staffSetBlocked(builderDb(), {
      tenantId: input.tenantId,
      blocked: input.blocked,
      reason: input.reason,
      userId,
    }),
  );
}

export interface PackageForm {
  id?: string;
  name: string;
  credits: number;
  /** Preço na moeda, com centavos (ex.: 49.9). */
  price: number;
  currency: 'brl' | 'usd';
  market: string;
  active: boolean;
  sortOrder: number;
  reason: string;
}

export async function savePackage(form: PackageForm): Promise<StaffActionResult> {
  if (form.id && !isUuid(form.id)) return { ok: false, error: (await texts()).generic };
  const priceCents = Math.round(Number(form.price) * 100);
  if (
    !form.name.trim() ||
    !/^[A-Za-z]{2}$/.test(form.market.trim()) ||
    !(priceCents > 0) ||
    !(Number(form.credits) > 0)
  )
    return { ok: false, error: (await texts()).amount };
  return run(null, form.reason, (userId) =>
    staffSavePackage(builderDb(), {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      credits: Number(form.credits),
      priceCents,
      currency: form.currency === 'usd' ? 'usd' : 'brl',
      market: form.market.trim().toUpperCase(),
      active: form.active,
      sortOrder: Math.trunc(Number(form.sortOrder) || 0),
      reason: form.reason,
      userId,
    }),
  );
}
