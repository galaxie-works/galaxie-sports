/**
 * Direitos do tenant e loja de features no painel do cliente (plataforma comercial, #1137). Só no servidor: lê o
 * catálogo de `config/catalog` (`CATALOG_DIR` na imagem) e resolve os direitos pelo banco, com a mesma função da API.
 */
import {
  entitlements,
  loadCatalog,
  storeView,
  type Catalog,
  type Entitlements,
  type StoreItem,
} from '@galaxie/billing';

import { builderDb } from '@/lib/builder/store';

declare global {
  var __galaxieCatalog: Catalog | undefined;
}

/** Catálogo carregado uma vez por processo (muda só no deploy). */
function catalog(): Catalog {
  globalThis.__galaxieCatalog ??= loadCatalog();
  return globalThis.__galaxieCatalog;
}

export interface TenantPlanStore {
  entitlements: Entitlements;
  items: StoreItem[];
}

/** Direitos e cartões da loja do tenant; null = tenant não existe. */
export async function getTenantPlanStore(tenantId: string): Promise<TenantPlanStore | null> {
  const c = catalog();
  const ent = await entitlements({ db: builderDb(), catalog: c }, tenantId);
  if (!ent) return null;
  return { entitlements: ent, items: storeView(c, ent) };
}
