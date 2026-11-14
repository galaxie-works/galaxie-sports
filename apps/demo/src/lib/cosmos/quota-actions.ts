'use server';

/**
 * Cotas da carteira por sala (#1116). Só quem tem `cosmos.manage` muda; o tenant e quem mudou saem da sessão, e o
 * pacote valida as cotas e grava o lançamento `quota_change` no extrato.
 */
import { isCosmosError, setQuotas } from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface QuotaResult {
  ok: boolean;
  error?: string;
}

export async function saveCosmosQuotas(quotas: unknown): Promise<QuotaResult> {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const t = getDictionary(locale).cosmos.quotas.errors;
  if (!ctx?.tenant || !ctx.actor || !can(ctx, 'cosmos.manage')) return { ok: false, error: t.forbidden };
  try {
    await setQuotas(builderDb(), { tenantId: ctx.tenant.id, quotas, userId: ctx.userId });
    return { ok: true };
  } catch (err) {
    if (isCosmosError(err) && err.code === 'invalid_quota') return { ok: false, error: t.invalid };
    if (isCosmosError(err) && err.code === 'no_wallet') return { ok: false, error: t.noWallet };
    console.error('[cosmos] cotas não salvaram', err);
    return { ok: false, error: t.generic };
  }
}
