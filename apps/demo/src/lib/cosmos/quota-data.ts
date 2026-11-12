/**
 * Cotas da carteira por sala (#1116) para a Visão geral da Cosmos: as cotas com o uso no ciclo e as salas que a tela
 * oferece (os produtos, as salas que já têm cota e as que aparecem no extrato).
 */
import { isQuotaScope, QUOTA_PRODUCTS, readQuotaOverview, type QuotaOverview } from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';

export interface CosmosQuotasData extends QuotaOverview {
  /** Escopos que a tela oferece para criar cota. */
  scopes: string[];
}

export async function loadCosmosQuotas(
  tenantId: string,
  seen: readonly string[] = [],
): Promise<CosmosQuotasData> {
  const overview = await readQuotaOverview(builderDb(), tenantId);
  return {
    ...overview,
    scopes: quotaScopes(
      overview.quotas.map((q) => q.scope),
      seen,
    ),
  };
}

/** Produtos primeiro, depois as salas (sem repetir e só no formato aceito). */
export function quotaScopes(own: readonly string[], seen: readonly string[]): string[] {
  const rooms = [...new Set([...own, ...seen])].filter((s) => isQuotaScope(s) && s.includes(':')).sort();
  return [...QUOTA_PRODUCTS, ...rooms];
}
