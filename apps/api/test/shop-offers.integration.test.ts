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
import type { ShopFetch } from '@galaxie/engage';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { buildServer } from '../src/server.js';
import { shopStoreSecretKey } from '../src/shop/offers.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const ADMIN_KEY = generateAdminKey();
const box = new SettingsSecretBox(['k'.repeat(40)]);
const teamId = randomUUID();
const tenantId = randomUUID();
const GALAXIE_TAG = 'galaxie-tag-20';

let pg: postgres.Sql;
let db: Database;
let app: FastifyInstance;
const meliCalls: string[] = [];

const fetchFn: ShopFetch = async (url) => {
  meliCalls.push(url);
  return {
    ok: true,
    status: 200,
    json: async () => [
      {
        code: 200,
        body: {
          id: 'MLB100',
          title: 'Camisa oficial',
          price: 349.9,
          currency_id: 'BRL',
          available_quantity: 5,
          status: 'active',
          pictures: [{ secure_url: 'https://img.example/1.jpg' }],
        },
      },
      {
        code: 200,
        body: { id: 'MLB200', title: 'Caneca', price: 60, available_quantity: 0, status: 'active' },
      },
    ],
  };
};

const get = (url: string) =>
  app.inject({
    method: 'GET',
    url,
    remoteAddress: '10.1.2.3',
    headers: { 'x-galaxie-admin-key': ADMIN_KEY, 'x-galaxie-actor': 'curadoria.shop' },
  });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  app = buildServer({
    db,
    usagePersist: false,
    authenticator: { cacheTtlMs: 0 },
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
    shopFetch: fetchFn,
    shopSecretBox: box,
  });
  await app.ready();

  const seal = (id: string, creds: object) => box.seal(shopStoreSecretKey(id), JSON.stringify(creds));
  await db.insert(shopStore).values([
    {
      id: 'amazon_br',
      name: 'Loja A',
      country: 'BR',
      network: 'amazon',
      active: true,
      clientPaths: ['client_code'],
      credentialsSealed: seal('amazon_br', { affiliateId: GALAXIE_TAG }),
      updatedBy: 'teste',
    },
    {
      id: 'meli_br',
      name: 'Loja B',
      country: 'BR',
      network: 'mercado_livre',
      active: true,
      position: 1,
      credentialsSealed: seal('meli_br', { affiliateId: GALAXIE_TAG, affiliateTool: '77', apiToken: 'tok' }),
      updatedBy: 'teste',
    },
    {
      id: 'desligada_br',
      name: 'Loja C',
      country: 'BR',
      network: 'amazon',
      active: false,
      position: 2,
      credentialsSealed: seal('desligada_br', { affiliateId: GALAXIE_TAG }),
      updatedBy: 'teste',
    },
  ]);
  const entityId = (
    await db
      .insert(shopEntity)
      .values({ entityKind: 'participant', entityId: teamId, updatedBy: 'teste' })
      .returning({ id: shopEntity.id })
  )[0]!.id;
  const base = { entityId, productType: 'home_kit', updatedBy: 'teste' };
  await db.insert(shopProduct).values([
    {
      ...base,
      storeId: 'amazon_br',
      storeProductId: 'B0001',
      title: 'Camisa 1',
      url: 'https://a.example/dp/B0001',
    },
    {
      ...base,
      storeId: 'meli_br',
      storeProductId: 'MLB100',
      title: 'Camisa',
      url: 'https://m.example/MLB-100',
    },
    {
      ...base,
      storeId: 'meli_br',
      storeProductId: 'MLB200',
      title: 'Caneca',
      url: 'https://m.example/MLB-200',
    },
    {
      ...base,
      storeId: 'desligada_br',
      storeProductId: 'B0002',
      title: 'Boné',
      url: 'https://a.example/dp/B0002',
    },
  ]);
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

const offersUrl = (q = '') => `/internal/shop/entities/participant/${teamId}/offers${q}`;

describe('ofertas do Shopping (#916)', () => {
  it('site Galaxie: lojas ligadas, tag da Galaxie, preço da API e sem o produto sem estoque', async () => {
    const res = await get(offersUrl());
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.map((s: { store: { id: string } }) => s.store.id)).toEqual(['amazon_br', 'meli_br']);
    expect(data[0].products).toEqual([
      expect.objectContaining({
        title: 'Camisa 1',
        price: null,
        source: 'curated',
        link: `https://a.example/dp/B0001?tag=${GALAXIE_TAG}`,
      }),
    ]);
    expect(data[1].products).toEqual([
      expect.objectContaining({
        title: 'Camisa oficial',
        price: 349.9,
        currency: 'BRL',
        image_url: 'https://img.example/1.jpg',
        source: 'live',
        link: `https://m.example/MLB-100?matt_word=${GALAXIE_TAG}&matt_tool=77`,
      }),
    ]);
    expect(data[1].products[0].fetched_at).toEqual(expect.any(String));
  });

  it('a segunda consulta vem do cache, sem ir à loja', async () => {
    const before = meliCalls.length;
    expect((await get(offersUrl())).statusCode).toBe(200);
    expect(meliCalls.length).toBe(before);
    const metrics = await app.metrics!.registry.getSingleMetricAsString(
      'galaxie_shop_connector_requests_total',
    );
    expect(metrics).toMatch(/store="meli_br",outcome="cache"\} [1-9]/);
    expect(metrics).toMatch(/store="meli_br",outcome="ok"\} 1/);
  });

  it('widget do cliente: nunca a tag da Galaxie; só a loja com o código do cliente liberado', async () => {
    const res = await get(offersUrl(`?tenant=${tenantId}&path=client_code&client_code=cliente-21`));
    expect(res.statusCode).toBe(200);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(GALAXIE_TAG);
    const { data } = res.json();
    expect(data.map((s: { store: { id: string } }) => s.store.id)).toEqual(['amazon_br']);
    expect(data[0].products[0].link).toBe('https://a.example/dp/B0001?tag=cliente-21');
    // sub-rede sem loja que libere: nada
    const sub = await get(offersUrl(`?tenant=${tenantId}&path=subnetwork&clickref=cli1`));
    expect(sub.json().data).toEqual([]);
    expect(JSON.stringify(sub.json())).not.toContain(GALAXIE_TAG);
  });

  it('entidade sem cadastro → 404', async () => {
    expect((await get(`/internal/shop/entities/participant/${randomUUID()}/offers`)).statusCode).toBe(404);
  });
});
