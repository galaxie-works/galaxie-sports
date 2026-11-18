/**
 * Direitos do tenant e loja de features no painel do cliente (plataforma comercial, #1137). Só no servidor: lê o
 * catálogo de `config/catalog` (`CATALOG_DIR` na imagem) e resolve os direitos pelo banco, com a mesma função da API.
 */
import { eq } from 'drizzle-orm';

import {
  entitlements,
  loadCatalog,
  storeView,
  type Catalog,
  type Entitlements,
  type StoreItem,
} from '@galaxie/billing';
import { moduleTrial } from '@galaxie/db/schema';

import { builderDb } from '@/lib/builder/store';

declare global {
  var __galaxieCatalog: Catalog | undefined;
}

/** Catálogo carregado uma vez por processo (muda só no deploy). */
export function catalog(): Catalog {
  globalThis.__galaxieCatalog ??= loadCatalog();
  return globalThis.__galaxieCatalog;
}

export interface TenantPlanStore {
  entitlements: Entitlements;
  items: StoreItem[];
}

/**
 * Direitos e cartões da loja do tenant; null = tenant não existe. Os testes de módulo que a organização já usou (em
 * curso ou vencidos, `billing.module_trial`) tiram o "Ativar teste" do cartão: é uma vez por módulo e organização
 * (F3, decisão 9). A demo não tem o cache do Valkey: cada leitura vai ao banco, e a API vê a mudança em até 60 s.
 */
export async function getTenantPlanStore(tenantId: string): Promise<TenantPlanStore | null> {
  const c = catalog();
  const db = builderDb();
  const ent = await entitlements({ db, catalog: c }, tenantId);
  if (!ent) return null;
  const trialsUsed = ent.organizationId
    ? (
        await db
          .select({ module: moduleTrial.module })
          .from(moduleTrial)
          .where(eq(moduleTrial.organizationId, ent.organizationId))
      ).map((r) => r.module)
    : [];
  return { entitlements: ent, items: storeView(c, ent, { trialsUsed }) };
}
