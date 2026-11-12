/**
 * Curadoria do Shopping (#914), só no servidor: as lojas da Galaxie, a ficha de cada entidade (time, seleção,
 * campeonato, atleta, piloto), o jeito de achar os produtos dela em cada loja e os produtos âncora. As regras de
 * entrada ficam em `catalog-input.ts`; a leitura para a API, em `@galaxie/db` (`shopAnchors`). Nada de imagem nem
 * preço: os dois vêm do conector da loja (#916).
 */
import type { PoolClient } from 'pg';

import { pool } from '@/lib/auth/db';

import {
  moveInOrder,
  type LookupInput,
  type ProductInput,
  type ProfileInput,
  type ShopEntityKind,
  type ShopLookupKind,
  type ShopNetwork,
  type ShopProductStatus,
  type ShopProductType,
  type StoreInput,
} from './catalog-input';

export class ShopCatalogError extends Error {
  constructor(readonly code: 'not_found' | 'duplicate' | 'duplicate_store' | 'store' | 'limit') {
    super(code);
    this.name = 'ShopCatalogError';
  }
}

/** Teto de produtos por entidade (aprovados e sugeridos): a curadoria busca 6 a 12. */
export const MAX_PRODUCTS_PER_ENTITY = 60;
/** Resultados por busca (a tela é para achar uma entidade, não para navegar o cadastro inteiro). */
export const SHOP_SEARCH_LIMIT = 30;

export interface ShopStoreView {
  id: string;
  name: string;
  country: string;
  network: ShopNetwork;
  homeUrl: string | null;
  active: boolean;
  position: number;
  products: number;
}

/** O que a tela mostra da entidade: o nome e o tipo vêm do `core`. */
export interface ShopEntityRefView {
  kind: ShopEntityKind;
  id: string;
  name: string;
  sport: string | null;
  /** `club`, `national_team`, `athlete`, `driver`, `fighter` (participante), `competition` ou `person`. */
  subtype: string;
  countryCode: string | null;
}

export interface ShopEntitySummary extends ShopEntityRefView {
  approved: number;
  suggested: number;
  updatedAt: string | null;
}

export interface ShopLookupView {
  storeId: string;
  lookupKind: ShopLookupKind;
  lookupValue: string;
  pageUrl: string | null;
}

export interface ShopProductView {
  id: string;
  storeId: string;
  storeProductId: string;
  productType: ShopProductType;
  title: string;
  season: string | null;
  url: string;
  active: boolean;
  position: number;
  status: ShopProductStatus;
  suggestedBy: string | null;
  reviewedBy: string | null;
  updatedAt: string;
}

export interface ShopEntityDetail {
  entity: ShopEntityRefView;
  profile: (ProfileInput & { version: number }) | null;
  lookups: ShopLookupView[];
  products: ShopProductView[];
}

const ACCENTED =
  '\u00e1\u00e0\u00e3\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ed\u00ec\u00ee\u00ef\u00f3\u00f2\u00f5\u00f4\u00f6\u00fa\u00f9\u00fb\u00fc\u00e7\u00f1\u0131\u00df';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucnis';
const fold = (s: string) => {
  let out = s.toLowerCase();
  for (let i = 0; i < ACCENTED.length; i++) out = out.split(ACCENTED[i]!).join(PLAIN[i]!);
  return out;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** As três origens da entidade num formato só (para buscar e para dar nome à ficha). */
const ENTITY_REFS = `
  select 'participant'::text as kind, p.id, p.name, p.short_name as alt, p.sport, p.kind::text as subtype,
         p.country_code
    from core.participant p
   where p.kind in ('club', 'national_team', 'athlete', 'driver', 'fighter')
  union all
  select 'competition', c.id, c.name, null, c.sport, 'competition', c.country_code from core.competition c
  union all
  select 'person', pe.id, pe.name, null, null, 'person', null from core.person pe`;

type RefRow = {
  kind: ShopEntityKind;
  id: string;
  name: string;
  sport: string | null;
  subtype: string;
  country_code: string | null;
};
const toRef = (r: RefRow): ShopEntityRefView => ({
  kind: r.kind,
  id: r.id,
  name: r.name,
  sport: r.sport,
  subtype: r.subtype,
  countryCode: r.country_code,
});

export async function listShopStores(): Promise<ShopStoreView[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    country: string;
    network: ShopNetwork;
    home_url: string | null;
    active: boolean;
    position: number;
    products: string;
  }>(
    `select s.id, s.name, s.country, s.network, s.home_url, s.active, s.position,
            (select count(*) from engage.shop_product p where p.store_id = s.id and p.status = 'approved') as products
       from engage.shop_store s
      order by s.country, s.position, s.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    network: r.network,
    homeUrl: r.home_url,
    active: r.active,
    position: r.position,
    products: Number(r.products),
  }));
}

/**
 * Cria a loja (`create`: código já usado é recusado, nunca sobrescreve outra loja) ou atualiza nome, país, rede,
 * endereço e ordem de uma que existe. Ligar e desligar fica com os conectores (#916).
 */
export async function saveShopStore(
  input: StoreInput,
  actor: string,
  opts: { create: boolean },
): Promise<void> {
  const values = [input.id, input.name, input.country, input.network, input.homeUrl, input.position, actor];
  const { rowCount } = opts.create
    ? await pool.query(
        `insert into engage.shop_store (id, name, country, network, home_url, position, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
        values,
      )
    : await pool.query(
        `update engage.shop_store set name = $2, country = $3, network = $4, home_url = $5, position = $6,
                updated_by = $7, updated_at = now()
          where id = $1`,
        values,
      );
  if (!rowCount) throw new ShopCatalogError(opts.create ? 'duplicate_store' : 'not_found');
}

/** Entidades já curadas, com quantos produtos aprovados e sugeridos têm (as que mais precisam de olho primeiro). */
export async function listCuratedEntities(): Promise<ShopEntitySummary[]> {
  const { rows } = await pool.query<
    RefRow & { approved: string; suggested: string; updated_at: Date | null }
  >(
    `select r.kind, r.id, r.name, r.sport, r.subtype, r.country_code,
            count(p.id) filter (where p.status = 'approved' and p.active) as approved,
            count(p.id) filter (where p.status = 'suggested') as suggested,
            greatest(e.updated_at, max(p.updated_at)) as updated_at
       from engage.shop_entity e
       join (${ENTITY_REFS}) r on r.kind = e.entity_kind and r.id = e.entity_id
       left join engage.shop_product p on p.entity_id = e.id
      group by r.kind, r.id, r.name, r.sport, r.subtype, r.country_code, e.updated_at
      order by count(p.id) filter (where p.status = 'suggested') desc, r.name`,
  );
  return rows.map((r) => ({
    ...toRef(r),
    approved: Number(r.approved),
    suggested: Number(r.suggested),
    updatedAt: iso(r.updated_at),
  }));
}

/** Busca por nome (sem acento) entre times, seleções, atletas, pilotos, campeonatos e jogadores. */
export async function searchShopEntities(query: string): Promise<ShopEntitySummary[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const folded = (col: string) => `translate(lower(${col}), $3, $4)`;
  const { rows } = await pool.query<
    RefRow & { approved: string | null; suggested: string | null; updated_at: Date | null }
  >(
    `select r.kind, r.id, r.name, r.sport, r.subtype, r.country_code,
            (select count(*) from engage.shop_product p where p.entity_id = e.id and p.status = 'approved' and p.active)
              as approved,
            (select count(*) from engage.shop_product p where p.entity_id = e.id and p.status = 'suggested')
              as suggested,
            e.updated_at
       from (${ENTITY_REFS}) r
       left join engage.shop_entity e on e.entity_kind = r.kind and e.entity_id = r.id
      where ${folded('r.name')} like $1 or ${folded("coalesce(r.alt, '')")} like $1
      order by (e.id is not null) desc, (${folded('r.name')} = $2) desc,
               case r.subtype when 'club' then 0 when 'national_team' then 1 when 'competition' then 2 else 3 end,
               length(r.name), r.name
      limit ${SHOP_SEARCH_LIMIT}`,
    [like, q, ACCENTED, PLAIN],
  );
  return rows.map((r) => ({
    ...toRef(r),
    approved: Number(r.approved ?? 0),
    suggested: Number(r.suggested ?? 0),
    updatedAt: iso(r.updated_at),
  }));
}

async function entityRef(kind: ShopEntityKind, id: string): Promise<ShopEntityRefView | null> {
  const { rows } = await pool.query<RefRow>(
    `select r.kind, r.id, r.name, r.sport, r.subtype, r.country_code from (${ENTITY_REFS}) r
      where r.kind = $1 and r.id = $2`,
    [kind, id],
  );
  return rows[0] ? toRef(rows[0]) : null;
}

export async function getShopEntity(kind: ShopEntityKind, id: string): Promise<ShopEntityDetail | null> {
  const entity = await entityRef(kind, id);
  if (!entity) return null;
  const { rows: profiles } = await pool.query<{
    id: string;
    kit_brand: string | null;
    kit_season: string | null;
    reviewed_season: string | null;
    version: number;
  }>(
    `select id, kit_brand, kit_season, reviewed_season, version from engage.shop_entity
      where entity_kind = $1 and entity_id = $2`,
    [kind, id],
  );
  const profile = profiles[0];
  if (!profile) return { entity, profile: null, lookups: [], products: [] };
  const [{ rows: lookups }, { rows: products }] = await Promise.all([
    pool.query<{
      store_id: string;
      lookup_kind: ShopLookupKind;
      lookup_value: string;
      page_url: string | null;
    }>(
      `select l.store_id, l.lookup_kind, l.lookup_value, l.page_url from engage.shop_entity_store l
         join engage.shop_store s on s.id = l.store_id
        where l.entity_id = $1 order by s.country, s.position, s.name`,
      [profile.id],
    ),
    pool.query<{
      id: string;
      store_id: string;
      store_product_id: string;
      product_type: ShopProductType;
      title: string;
      season: string | null;
      url: string;
      active: boolean;
      position: number;
      status: ShopProductStatus;
      suggested_by: string | null;
      reviewed_by: string | null;
      updated_at: Date;
    }>(
      `select p.id, p.store_id, p.store_product_id, p.product_type, p.title, p.season, p.url, p.active, p.position,
              p.status, p.suggested_by, p.reviewed_by, p.updated_at
         from engage.shop_product p join engage.shop_store s on s.id = p.store_id
        where p.entity_id = $1
        order by s.country, s.position, s.name, p.position, p.title`,
      [profile.id],
    ),
  ]);
  return {
    entity,
    profile: {
      kitBrand: profile.kit_brand,
      kitSeason: profile.kit_season,
      reviewedSeason: profile.reviewed_season,
      version: profile.version,
    },
    lookups: lookups.map((l) => ({
      storeId: l.store_id,
      lookupKind: l.lookup_kind,
      lookupValue: l.lookup_value,
      pageUrl: l.page_url,
    })),
    products: products.map((p) => ({
      id: p.id,
      storeId: p.store_id,
      storeProductId: p.store_product_id,
      productType: p.product_type,
      title: p.title,
      season: p.season,
      url: p.url,
      active: p.active,
      position: p.position,
      status: p.status,
      suggestedBy: p.suggested_by,
      reviewedBy: p.reviewed_by,
      updatedAt: p.updated_at.toISOString(),
    })),
  };
}

/** Id da ficha, criada na primeira gravação. A entidade precisa existir no `core`. */
async function ensureEntity(kind: ShopEntityKind, id: string, actor: string): Promise<string> {
  if (!(await entityRef(kind, id))) throw new ShopCatalogError('not_found');
  const { rows } = await pool.query<{ id: string }>(
    `insert into engage.shop_entity (entity_kind, entity_id, updated_by) values ($1, $2, $3)
     on conflict (entity_kind, entity_id) do update set entity_kind = excluded.entity_kind
     returning id`,
    [kind, id, actor],
  );
  return rows[0]!.id;
}

export async function saveShopProfile(
  kind: ShopEntityKind,
  id: string,
  input: ProfileInput,
  actor: string,
): Promise<void> {
  const entityId = await ensureEntity(kind, id, actor);
  await pool.query(
    `update engage.shop_entity set kit_brand = $2, kit_season = $3, reviewed_season = $4, version = version + 1,
            updated_by = $5, updated_at = now()
      where id = $1`,
    [entityId, input.kitBrand, input.kitSeason, input.reviewedSeason, actor],
  );
}

const pgCode = (err: unknown) => (err as { code?: string }).code;

export async function saveShopLookup(
  kind: ShopEntityKind,
  id: string,
  input: LookupInput,
  actor: string,
): Promise<void> {
  const entityId = await ensureEntity(kind, id, actor);
  try {
    await pool.query(
      `insert into engage.shop_entity_store (entity_id, store_id, lookup_kind, lookup_value, page_url, updated_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (entity_id, store_id) do update set lookup_kind = excluded.lookup_kind,
         lookup_value = excluded.lookup_value, page_url = excluded.page_url, updated_by = excluded.updated_by,
         updated_at = now()`,
      [entityId, input.storeId, input.lookupKind, input.lookupValue, input.pageUrl, actor],
    );
  } catch (err) {
    if (pgCode(err) === '23503') throw new ShopCatalogError('store');
    throw err;
  }
}

export async function removeShopLookup(kind: ShopEntityKind, id: string, storeId: string): Promise<void> {
  await pool.query(
    `delete from engage.shop_entity_store l using engage.shop_entity e
      where l.entity_id = e.id and e.entity_kind = $1 and e.entity_id = $2 and l.store_id = $3`,
    [kind, id, storeId],
  );
}

/** Transação no pool da demo: commit no fim, rollback se der erro. */
async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Produto curado por uma pessoa: entra aprovado, no fim da fila da loja. A ficha fica travada durante a conta, para
 * duas inclusões ao mesmo tempo não passarem do teto nem pegarem a mesma posição.
 */
export async function addShopProduct(
  kind: ShopEntityKind,
  id: string,
  input: ProductInput,
  actor: string,
): Promise<void> {
  const entityId = await ensureEntity(kind, id, actor);
  try {
    await inTransaction(async (client) => {
      await client.query(`select 1 from engage.shop_entity where id = $1 for update`, [entityId]);
      const { rows } = await client.query<{ n: string; next: number }>(
        `select count(*) filter (where status <> 'rejected') as n,
                coalesce(max(position) filter (where store_id = $2 and status <> 'rejected'), -1) + 1 as next
           from engage.shop_product where entity_id = $1`,
        [entityId, input.storeId],
      );
      if (Number(rows[0]?.n ?? 0) >= MAX_PRODUCTS_PER_ENTITY) throw new ShopCatalogError('limit');
      await client.query(
        `insert into engage.shop_product
           (entity_id, store_id, store_product_id, product_type, title, season, url, position, status,
            reviewed_by, reviewed_at, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9, now(), $9)`,
        [
          entityId,
          input.storeId,
          input.storeProductId,
          input.productType,
          input.title,
          input.season,
          input.url,
          rows[0]?.next ?? 0,
          actor,
        ],
      );
    });
  } catch (err) {
    if (pgCode(err) === '23505') throw new ShopCatalogError('duplicate');
    if (pgCode(err) === '23503') throw new ShopCatalogError('store');
    throw err;
  }
}

/** Filtro do produto pela entidade da página: um id de outra entidade (aba antiga, id trocado) não muda nada. */
const OF_ENTITY = `entity_id = (select e.id from engage.shop_entity e where e.entity_kind = $2 and e.entity_id = $3)`;

/** Corrige tipo, nome, temporada e link. Loja e id do produto na loja não mudam (outro produto = outra linha). */
export async function updateShopProduct(
  kind: ShopEntityKind,
  id: string,
  productId: string,
  input: Pick<ProductInput, 'productType' | 'title' | 'season' | 'url'>,
  actor: string,
): Promise<void> {
  const { rowCount } = await pool.query(
    `update engage.shop_product set product_type = $4, title = $5, season = $6, url = $7, updated_by = $8,
            updated_at = now()
      where id = $1 and ${OF_ENTITY}`,
    [productId, kind, id, input.productType, input.title, input.season, input.url, actor],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}

export async function setShopProductActive(
  kind: ShopEntityKind,
  id: string,
  productId: string,
  active: boolean,
  actor: string,
): Promise<void> {
  const { rowCount } = await pool.query(
    `update engage.shop_product set active = $4, updated_by = $5, updated_at = now()
      where id = $1 and ${OF_ENTITY}`,
    [productId, kind, id, active, actor],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}

/**
 * Aprova ou recusa. Recusar vale para sugestão e aprovado; recusado fica guardado para a IA não sugerir de novo e
 * pode ser aprovado depois (recusa por engano), voltando ao fim da fila da loja.
 */
export async function reviewShopProduct(
  kind: ShopEntityKind,
  id: string,
  productId: string,
  verdict: 'approved' | 'rejected',
  actor: string,
): Promise<void> {
  const from = verdict === 'approved' ? ['suggested', 'rejected'] : ['suggested', 'approved'];
  const { rowCount } = await pool.query(
    `update engage.shop_product p set status = $4, reviewed_by = $5, reviewed_at = now(), updated_by = $5,
            updated_at = now(),
            position = case when p.status = 'rejected' then coalesce((
              select max(o.position) + 1 from engage.shop_product o
               where o.entity_id = p.entity_id and o.store_id = p.store_id and o.status <> 'rejected'), 0)
              else p.position end
      where p.id = $1 and p.${OF_ENTITY} and p.status = any($6::text[])`,
    [productId, kind, id, verdict, actor, from],
  );
  if (!rowCount) throw new ShopCatalogError('not_found');
}

/** Sobe ou desce o produto entre os da mesma loja e regrava as posições sem buraco (0..n-1). */
export async function moveShopProduct(
  kind: ShopEntityKind,
  id: string,
  productId: string,
  direction: 'up' | 'down',
  actor: string,
): Promise<void> {
  await inTransaction(async (client) => {
    const { rows: me } = await client.query<{ entity_id: string; store_id: string }>(
      `select entity_id, store_id from engage.shop_product where id = $1 and ${OF_ENTITY} for update`,
      [productId, kind, id],
    );
    if (!me[0]) throw new ShopCatalogError('not_found');
    const { rows } = await client.query<{ id: string }>(
      `select id from engage.shop_product where entity_id = $1 and store_id = $2 and status <> 'rejected'
        order by position, title for update`,
      [me[0].entity_id, me[0].store_id],
    );
    const next = moveInOrder(
      rows.map((r) => r.id),
      productId,
      direction,
    );
    if (next)
      await client.query(
        `update engage.shop_product p set position = o.pos - 1, updated_by = $2, updated_at = now()
           from unnest($1::uuid[]) with ordinality as o(id, pos)
          where p.id = o.id and p.position <> o.pos - 1`,
        [next, actor],
      );
  });
}
