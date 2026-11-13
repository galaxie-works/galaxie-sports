import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
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
import { generateAdminKey, hashAdminKey } from '../src/admin/guard.js';
import { loadPlans } from '../src/admin/plans.js';
import { buildServer } from '../src/server.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;
const ADMIN_KEY = generateAdminKey();
const teamId = randomUUID();

let pg: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;

const get = (url: string, admin = true) =>
  app.inject({
    method: 'GET',
    url,
    remoteAddress: '10.1.2.3',
    headers: admin ? { 'x-galaxie-admin-key': ADMIN_KEY, 'x-galaxie-actor': 'curadoria.shop' } : {},
  });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  app = buildServer({
    db,
    redis,
    keyPrefix,
    usagePersist: false,
    authenticator: { cacheTtlMs: 0 },
    admin: { keyHashes: [hashAdminKey(ADMIN_KEY)], ipAllowlist: ['10.0.0.0/8'], plans: loadPlans() },
  });
  await app.ready();

  await db.insert(shopStore).values([
    { id: 'loja_a_br', name: 'Loja A', country: 'BR', network: 'mercado_livre', updatedBy: 'teste' },
    { id: 'loja_b_us', name: 'Loja B', country: 'US', network: 'impact', updatedBy: 'teste' },
  ]);
  const entityId = (
    await db
      .insert(shopEntity)
      .values({ entityKind: 'participant', entityId: teamId, kitBrand: 'Marca', updatedBy: 'teste' })
      .returning({ id: shopEntity.id })
  )[0]!.id;
  const base = { entityId, productType: 'home_kit', updatedBy: 'teste' };
  await db.insert(shopProduct).values([
    {
      ...base,
      storeId: 'loja_a_br',
      storeProductId: 'A1',
      title: 'Camisa 1',
      url: 'https://loja.example/a1',
    },
    {
      ...base,
      storeId: 'loja_a_br',
      storeProductId: 'A2',
      title: 'Sugestão',
      url: 'https://loja.example/a2',
      status: 'suggested',
    },
    {
      ...base,
      storeId: 'loja_b_us',
      storeProductId: 'B1',
      title: 'Home jersey',
      url: 'https://loja.example/b1',
    },
  ]);
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

describe('rotas internas do Shopping (#914)', () => {
  it('sem chave administrativa → 401', async () => {
    expect((await get('/internal/shop/stores', false)).statusCode).toBe(401);
    expect((await get(`/internal/shop/entities/participant/${teamId}/anchors`, false)).statusCode).toBe(401);
  });

  it('lista as lojas, com filtro por país', async () => {
    const all = await get('/internal/shop/stores');
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((s: { id: string }) => s.id)).toEqual(['loja_a_br', 'loja_b_us']);
    const us = await get('/internal/shop/stores?country=us');
    expect(us.json().data).toEqual([
      {
        id: 'loja_b_us',
        name: 'Loja B',
        country: 'US',
        network: 'impact',
        home_url: null,
        active: false,
        position: 0,
      },
    ]);
  });

  it('devolve as âncoras aprovadas da entidade por loja, sem imagem nem preço', async () => {
    const res = await get(`/internal/shop/entities/participant/${teamId}/anchors?country=BR`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { data } = res.json();
    expect(data.entity).toMatchObject({ kind: 'participant', id: teamId, kit_brand: 'Marca' });
    expect(data.stores).toHaveLength(1);
    expect(data.stores[0].products).toEqual([
      expect.objectContaining({
        store_product_id: 'A1',
        product_type: 'home_kit',
        url: 'https://loja.example/a1',
      }),
    ]);
    expect(JSON.stringify(data)).not.toMatch(/image|price/);
  });

  it('entidade sem cadastro → 404; tipo ou id inválido → 400', async () => {
    expect((await get(`/internal/shop/entities/participant/${randomUUID()}/anchors`)).statusCode).toBe(404);
    expect((await get(`/internal/shop/entities/venue/${teamId}/anchors`)).statusCode).toBe(400);
    expect((await get('/internal/shop/entities/participant/123/anchors')).statusCode).toBe(400);
    expect((await get(`/internal/shop/entities/participant/${teamId}/anchors?store=X`)).statusCode).toBe(400);
  });
});
