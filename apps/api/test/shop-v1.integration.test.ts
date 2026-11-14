import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  runMigrations,
  shopEntity,
  shopProduct,
  shopStore,
  type Database,
} from '@galaxie/db';
import { shopStoreSecretKey } from '@galaxie/engage';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';
import { ShopClickSigner } from '../src/shop/click-token.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const box = new SettingsSecretBox(['k'.repeat(40)]);
const teamId = randomUUID();
const eventId = randomUUID();
const TAG = 'galaxie-tag-20';

let pg: postgres.Sql;
let db: Database;
let app: FastifyInstance;
let galaxieKey = '';
let clientKey = '';
let noModuleKey = '';
let productId = '';

const get = (url: string, key: string) =>
  app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });

  const modules = ['core_data', 'shopping'] as ('core_data' | 'shopping')[];
  const galaxie = await upsertTenant(db, {
    slug: 'galaxie-site',
    name: 'Galaxie',
    plan: 'enterprise',
    modules,
  });
  const client = await upsertTenant(db, { slug: 'portal-x', name: 'Portal', plan: 'enterprise', modules });
  const plain = await upsertTenant(db, { slug: 'sem-shop', name: 'Sem', plan: 'core_data' });
  galaxieKey = (await createApiKey(db, galaxie.id, { env: 'test' })).key;
  clientKey = (await createApiKey(db, client.id, { env: 'test' })).key;
  noModuleKey = (await createApiKey(db, plain.id, { env: 'test' })).key;

  app = buildServer({
    db,
    usagePersist: false,
    authenticator: { cacheTtlMs: 0 },
    publicUrl: 'https://api.example',
    shopSecretBox: box,
    shopGalaxieTenantIds: galaxie.id,
    shopClickSigner: new ShopClickSigner('s'.repeat(40)),
  });
  await app.ready();

  await db.insert(shopStore).values({
    id: 'amazon_br',
    name: 'Loja A',
    country: 'BR',
    network: 'amazon',
    active: true,
    credentialsSealed: box.seal(shopStoreSecretKey('amazon_br'), JSON.stringify({ affiliateId: TAG })),
    updatedBy: 'teste',
  });
  const entityId = (
    await db
      .insert(shopEntity)
      .values({ entityKind: 'participant', entityId: teamId, updatedBy: 'teste' })
      .returning({ id: shopEntity.id })
  )[0]!.id;
  productId = (
    await db
      .insert(shopProduct)
      .values({
        entityId,
        storeId: 'amazon_br',
        storeProductId: 'B1',
        productType: 'home_kit',
        title: 'Camisa 1',
        url: 'https://a.example/dp/B1',
        updatedBy: 'teste',
      })
      .returning({ id: shopProduct.id })
  )[0]!.id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

describe('GET /v1/shop/{kind}/{id} (#921)', () => {
  it('tenant da Galaxie: produtos com o botão passando pela rota de cliques', async () => {
    const res = await get(
      `/v1/shop/participant/${teamId}?country=BR&event=${eventId}&lang=pt-BR`,
      galaxieKey,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.disclosure).toBe('affiliate');
    expect(body.stores).toHaveLength(1);
    const p = body.stores[0].products[0];
    expect(p).toMatchObject({ id: productId, title: 'Camisa 1', product_type: 'home_kit', price: null });
    const buy = new URL(p.buy_url);
    expect(buy.origin + buy.pathname).toBe(`https://api.example/go/shop/${productId}`);
    expect(Object.fromEntries([...buy.searchParams].filter(([k]) => k !== 't'))).toEqual({
      origin: 'site',
      event: eventId,
      lang: 'pt-BR',
    });
    // o link vem assinado: a rota de cliques só põe o código da Galaxie em link da vitrine dela
    expect(buy.searchParams.get('t')).toMatch(/^\d+\.[A-Za-z0-9_-]{32}$/);
    // o link da loja (com a tag) nunca vai na resposta: só a rota de cliques monta
    expect(JSON.stringify(body)).not.toContain(TAG);
  });

  it('outro tenant com o módulo: lista vazia, nunca o código da Galaxie', async () => {
    const res = await get(`/v1/shop/participant/${teamId}`, clientKey);
    expect(res.statusCode).toBe(200);
    expect(res.json().stores).toEqual([]);
    expect(JSON.stringify(res.json())).not.toContain(TAG);
  });

  it('sem o módulo shopping: 403', async () => {
    expect((await get(`/v1/shop/participant/${teamId}`, noModuleKey)).statusCode).toBe(403);
  });

  it('entidade sem cadastro: 404; tipo inválido: 400', async () => {
    expect((await get(`/v1/shop/participant/${randomUUID()}`, galaxieKey)).statusCode).toBe(404);
    expect((await get(`/v1/shop/venue/${teamId}`, galaxieKey)).statusCode).toBe(400);
  });
});
