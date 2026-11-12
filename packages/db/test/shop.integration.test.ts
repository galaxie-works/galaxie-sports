import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  listShopStores,
  runMigrations,
  shopAnchors,
  shopEntity,
  shopEntityStore,
  shopProduct,
  shopStore,
  type Database,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let pg: postgres.Sql;
let db: Database;
const teamId = randomUUID();
let entityId: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });

  await db.insert(shopStore).values([
    { id: 'loja_a_br', name: 'Loja A', country: 'BR', network: 'amazon', position: 2, updatedBy: 'teste' },
    { id: 'loja_b_br', name: 'Loja B', country: 'BR', network: 'awin', position: 1, updatedBy: 'teste' },
    { id: 'loja_c_us', name: 'Loja C', country: 'US', network: 'impact', position: 1, updatedBy: 'teste' },
  ]);
  entityId = (
    await db
      .insert(shopEntity)
      .values({
        entityKind: 'participant',
        entityId: teamId,
        kitBrand: 'Marca',
        kitSeason: '2026',
        updatedBy: 'teste',
      })
      .returning({ id: shopEntity.id })
  )[0]!.id;
  await db.insert(shopEntityStore).values({
    entityId,
    storeId: 'loja_b_br',
    lookupKind: 'official_seller',
    lookupValue: 'vendedor-oficial',
    updatedBy: 'teste',
  });
  const product = (
    storeId: string,
    storeProductId: string,
    position: number,
    extra: Partial<typeof shopProduct.$inferInsert> = {},
  ) => ({
    entityId,
    storeId,
    storeProductId,
    productType: 'home_kit',
    title: `Camisa ${storeProductId}`,
    url: `https://loja.example/${storeProductId}`,
    position,
    updatedBy: 'teste',
    ...extra,
  });
  await db
    .insert(shopProduct)
    .values([
      product('loja_a_br', 'A2', 2),
      product('loja_a_br', 'A1', 1),
      product('loja_b_br', 'B1', 0),
      product('loja_b_br', 'B-off', 1, { active: false }),
      product('loja_b_br', 'B-ia', 2, { status: 'suggested', suggestedBy: 'ai:shopping' }),
      product('loja_c_us', 'C1', 0),
    ]);
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

/** O drizzle embrulha o erro do driver: o nome da constraint vem na causa. */
const constraintOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { constraint_name?: string; cause?: { constraint_name?: string } };
    return e.constraint_name ?? e.cause?.constraint_name ?? null;
  }
};

describe('catálogo do Shopping (#914)', () => {
  it('lista as lojas por país e na ordem sugerida', async () => {
    expect((await listShopStores(db)).map((s) => s.id)).toEqual(['loja_b_br', 'loja_a_br', 'loja_c_us']);
    expect((await listShopStores(db, { country: 'us' })).map((s) => s.id)).toEqual(['loja_c_us']);
  });

  it('devolve as âncoras aprovadas e ativas, por loja e na ordem', async () => {
    const r = await shopAnchors(db, { kind: 'participant', id: teamId });
    expect(r?.entity.kitBrand).toBe('Marca');
    expect(r?.stores.map((s) => [s.store.id, s.products.map((p) => p.storeProductId)])).toEqual([
      ['loja_b_br', ['B1']],
      ['loja_a_br', ['A1', 'A2']],
      ['loja_c_us', ['C1']],
    ]);
    expect(r?.stores[0]?.lookup).toEqual({
      kind: 'official_seller',
      value: 'vendedor-oficial',
      pageUrl: null,
    });
    expect(r?.stores[1]?.lookup).toBeNull();
  });

  it('filtra por loja e por país', async () => {
    const one = await shopAnchors(db, { kind: 'participant', id: teamId }, { store: 'loja_a_br' });
    expect(one?.stores.map((s) => s.store.id)).toEqual(['loja_a_br']);
    const us = await shopAnchors(db, { kind: 'participant', id: teamId }, { country: 'US' });
    expect(us?.stores.map((s) => s.store.id)).toEqual(['loja_c_us']);
  });

  it('entidade sem ficha devolve null', async () => {
    expect(await shopAnchors(db, { kind: 'participant', id: randomUUID() })).toBeNull();
    expect(await shopAnchors(db, { kind: 'competition', id: teamId })).toBeNull();
  });

  it('não guarda imagem nem preço', async () => {
    const cols = await pg<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'engage' and table_name like 'shop\\_%'`;
    const names = cols.map((c) => c.column_name);
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => /image|img|photo|price|amount|currency/.test(n))).toEqual([]);
  });

  it('recusa link sem https, tipo desconhecido e produto repetido na mesma loja', async () => {
    const base = {
      entityId,
      storeId: 'loja_a_br',
      productType: 'mug',
      title: 'Caneca',
      updatedBy: 'teste',
    };
    expect(
      await constraintOf(
        db.insert(shopProduct).values({ ...base, storeProductId: 'X1', url: 'http://loja.example/x1' }),
      ),
    ).toBe('shop_product_url_https');
    expect(
      await constraintOf(
        db
          .insert(shopProduct)
          .values({ ...base, storeProductId: 'X2', url: 'https://loja.example/x2', productType: 'sticker' }),
      ),
    ).toBe('shop_product_type');
    expect(
      await constraintOf(
        db.insert(shopProduct).values({ ...base, storeProductId: 'A1', url: 'https://loja.example/a1' }),
      ),
    ).toBe('shop_product_store_item_uq');
  });

  it('uma ficha por entidade; apagar a ficha leva os produtos junto', async () => {
    expect(
      await constraintOf(
        db.insert(shopEntity).values({ entityKind: 'participant', entityId: teamId, updatedBy: 'teste' }),
      ),
    ).toBe('shop_entity_ref_uq');
    const other = (
      await db
        .insert(shopEntity)
        .values({ entityKind: 'competition', entityId: randomUUID(), updatedBy: 'teste' })
        .returning({ id: shopEntity.id })
    )[0]!.id;
    await db.insert(shopProduct).values({
      entityId: other,
      storeId: 'loja_a_br',
      storeProductId: 'L1',
      productType: 'ball',
      title: 'Bola oficial',
      url: 'https://loja.example/l1',
      updatedBy: 'teste',
    });
    await pg`delete from engage.shop_entity where id = ${other}`;
    expect((await pg`select 1 from engage.shop_product where entity_id = ${other}`).length).toBe(0);
  });
});
