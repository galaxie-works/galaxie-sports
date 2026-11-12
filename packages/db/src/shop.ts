/**
 * Leitura do catálogo do Shopping (#914) para a API: as lojas da Galaxie e os produtos âncora de uma entidade, por
 * loja. Só produto aprovado e ativo entra; sugestão da IA (`suggested`) espera uma pessoa. A curadoria (gravação)
 * fica na tela de Ajustes → Engajamento → Shopping. Imagem e preço não existem aqui: vêm do conector da loja (#916).
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  shopClick,
  shopEntity,
  shopEntityStore,
  shopProduct,
  shopStore,
  type ShopEntityKind,
  type ShopLookupKind,
  type ShopNetwork,
  type ShopProductType,
} from './schema/shop.js';

export interface ShopStoreRow {
  id: string;
  name: string;
  country: string;
  network: ShopNetwork;
  homeUrl: string | null;
  active: boolean;
  position: number;
}

export interface ShopAnchor {
  id: string;
  storeProductId: string;
  productType: ShopProductType;
  title: string;
  season: string | null;
  url: string;
  position: number;
}

export interface ShopStoreAnchors {
  store: ShopStoreRow;
  lookup: { kind: ShopLookupKind; value: string; pageUrl: string | null } | null;
  products: ShopAnchor[];
}

export interface ShopEntityAnchors {
  entity: {
    kind: ShopEntityKind;
    id: string;
    kitBrand: string | null;
    kitSeason: string | null;
    reviewedSeason: string | null;
  };
  stores: ShopStoreAnchors[];
}

const storeColumns = {
  id: shopStore.id,
  name: shopStore.name,
  country: shopStore.country,
  network: shopStore.network,
  homeUrl: shopStore.homeUrl,
  active: shopStore.active,
  position: shopStore.position,
};

/** Lojas da Galaxie, por país e na ordem sugerida (desempate pelo nome). */
export async function listShopStores(
  db: Database,
  opts: { country?: string | undefined } = {},
): Promise<ShopStoreRow[]> {
  const rows = await db
    .select(storeColumns)
    .from(shopStore)
    .where(opts.country ? eq(shopStore.country, opts.country.toUpperCase()) : undefined)
    .orderBy(asc(shopStore.country), asc(shopStore.position), asc(shopStore.name));
  return rows as ShopStoreRow[];
}

/**
 * Âncoras de uma entidade, agrupadas por loja (ordem da loja, depois a do produto). `store` filtra uma loja;
 * `country` filtra as lojas de um país. Entidade sem ficha: null. Loja sem produto aprovado e ativo fica de fora,
 * mesmo com o jeito de achar cadastrado.
 */
export async function shopAnchors(
  db: Database,
  ref: { kind: ShopEntityKind; id: string },
  opts: { store?: string | undefined; country?: string | undefined } = {},
): Promise<ShopEntityAnchors | null> {
  const [entity] = await db
    .select({
      id: shopEntity.id,
      kitBrand: shopEntity.kitBrand,
      kitSeason: shopEntity.kitSeason,
      reviewedSeason: shopEntity.reviewedSeason,
    })
    .from(shopEntity)
    .where(and(eq(shopEntity.entityKind, ref.kind), eq(shopEntity.entityId, ref.id)));
  if (!entity) return null;

  const storeFilter = and(
    opts.store ? eq(shopStore.id, opts.store) : undefined,
    opts.country ? eq(shopStore.country, opts.country.toUpperCase()) : undefined,
  );
  const products = await db
    .select({
      store: storeColumns,
      id: shopProduct.id,
      storeProductId: shopProduct.storeProductId,
      productType: shopProduct.productType,
      title: shopProduct.title,
      season: shopProduct.season,
      url: shopProduct.url,
      position: shopProduct.position,
    })
    .from(shopProduct)
    .innerJoin(shopStore, eq(shopStore.id, shopProduct.storeId))
    .where(
      and(
        eq(shopProduct.entityId, entity.id),
        eq(shopProduct.status, 'approved'),
        eq(shopProduct.active, true),
        storeFilter,
      ),
    )
    .orderBy(
      asc(shopStore.country),
      asc(shopStore.position),
      asc(shopStore.name),
      asc(shopProduct.position),
      asc(shopProduct.title),
    );
  const lookups = await db
    .select({
      storeId: shopEntityStore.storeId,
      kind: shopEntityStore.lookupKind,
      value: shopEntityStore.lookupValue,
      pageUrl: shopEntityStore.pageUrl,
    })
    .from(shopEntityStore)
    .where(eq(shopEntityStore.entityId, entity.id));
  const lookupOf = new Map(lookups.map((l) => [l.storeId, l]));

  const byStore = new Map<string, ShopStoreAnchors>();
  for (const p of products) {
    let group = byStore.get(p.store.id);
    if (!group) {
      const l = lookupOf.get(p.store.id);
      group = {
        store: p.store as ShopStoreRow,
        lookup: l ? { kind: l.kind as ShopLookupKind, value: l.value, pageUrl: l.pageUrl } : null,
        products: [],
      };
      byStore.set(p.store.id, group);
    }
    group.products.push({
      id: p.id,
      storeProductId: p.storeProductId,
      productType: p.productType as ShopProductType,
      title: p.title,
      season: p.season,
      url: p.url,
      position: p.position,
    });
  }
  return {
    entity: {
      kind: ref.kind,
      id: ref.id,
      kitBrand: entity.kitBrand,
      kitSeason: entity.kitSeason,
      reviewedSeason: entity.reviewedSeason,
    },
    stores: [...byStore.values()],
  };
}

/** A loja com o que os conectores precisam (#916): matriz de caminhos, configuração e credenciais ainda cifradas. */
export interface ShopStoreConnectorRow extends ShopStoreRow {
  clientPaths: string[];
  config: Record<string, string>;
  credentialsSealed: string | null;
}

export async function listShopStoreConnectorRows(db: Database): Promise<ShopStoreConnectorRow[]> {
  const rows = await db
    .select({
      ...storeColumns,
      clientPaths: shopStore.clientPaths,
      config: shopStore.config,
      credentialsSealed: shopStore.credentialsSealed,
    })
    .from(shopStore)
    .orderBy(asc(shopStore.country), asc(shopStore.position), asc(shopStore.name));
  return rows as ShopStoreConnectorRow[];
}

/** O produto de um clique (#918): só aprovado e ativo, com a entidade e a loja dele. */
export interface ShopClickTarget {
  productId: string;
  storeId: string;
  storeProductId: string;
  title: string;
  url: string;
  entityKind: ShopEntityKind;
  entityId: string;
}

export async function shopClickTarget(db: Database, productId: string): Promise<ShopClickTarget | null> {
  const [row] = await db
    .select({
      productId: shopProduct.id,
      storeId: shopProduct.storeId,
      storeProductId: shopProduct.storeProductId,
      title: shopProduct.title,
      url: shopProduct.url,
      entityKind: shopEntity.entityKind,
      entityId: shopEntity.entityId,
    })
    .from(shopProduct)
    .innerJoin(shopEntity, eq(shopEntity.id, shopProduct.entityId))
    .where(
      and(eq(shopProduct.id, productId), eq(shopProduct.status, 'approved'), eq(shopProduct.active, true)),
    );
  return (row as ShopClickTarget | undefined) ?? null;
}

export type ShopClickRow = typeof shopClick.$inferInsert;

/** Grava um lote de cliques (a API junta em memória e grava depois do redirecionamento). */
export async function recordShopClicks(db: Database, rows: ShopClickRow[]): Promise<void> {
  if (rows.length) await db.insert(shopClick).values(rows);
}
