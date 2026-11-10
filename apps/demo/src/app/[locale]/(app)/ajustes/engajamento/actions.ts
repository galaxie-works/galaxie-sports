'use server';

/**
 * Ações de Ajustes → Engajamento → Países (#954), só admin da Galaxie: gravar uma ficha (com versão e motivo) e os
 * países de um cliente. A sessão de admin é conferida de novo no servidor; as regras ficam em `@galaxie/engage`.
 */
import type { CountryPolicy, PolicyIssue, TenantCountry } from '@galaxie/engage';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { isUuid } from '@/lib/client/tenants';
import { PolicyError, savePolicy, setTenantCountries } from '@/lib/engage/country-policies';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface PolicyActionResult {
  ok: boolean;
  error?: string;
  issues?: PolicyIssue[];
  version?: number;
}

const PATH = '/ajustes/engajamento';

async function fail(err: unknown): Promise<PolicyActionResult> {
  const t = getDictionary(await getRequestLocale()).countryPolicies.errors;
  if (err instanceof PolicyError) return { ok: false, error: t[err.code], issues: err.issues };
  console.error('ajustes/engajamento: ação falhou', err);
  return { ok: false, error: t.generic };
}

export async function savePolicyAction(input: {
  country: string;
  policy: CountryPolicy;
  expectedVersion: number | null;
  reason: string;
  allowLowerWriteAge: boolean;
}): Promise<PolicyActionResult> {
  const me = await requireAdmin();
  try {
    if (typeof input?.country !== 'string' || !input.policy || typeof input.policy !== 'object')
      throw new PolicyError('invalid');
    const { version } = await savePolicy({
      country: input.country,
      policy: input.policy,
      expectedVersion: typeof input.expectedVersion === 'number' ? input.expectedVersion : null,
      reason: typeof input.reason === 'string' ? input.reason.slice(0, 500) : null,
      allowLowerWriteAge: input.allowLowerWriteAge === true,
      actor: `galaxie:${me.id}`,
    });
    revalidatePath(PATH);
    return { ok: true, version };
  } catch (err) {
    return fail(err);
  }
}

export async function setTenantCountriesAction(
  tenantId: string,
  countries: TenantCountry[],
): Promise<PolicyActionResult> {
  const me = await requireAdmin();
  try {
    if (!isUuid(tenantId) || !Array.isArray(countries) || countries.length > 60)
      throw new PolicyError('invalid');
    await setTenantCountries(
      tenantId,
      countries.map((c) => ({
        country: String(c.country),
        primary: c.primary === true,
        hardening: c.hardening && typeof c.hardening === 'object' ? c.hardening : null,
      })),
      `galaxie:${me.id}`,
    );
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
