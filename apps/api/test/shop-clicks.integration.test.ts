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
import { buildServer } from '../src/server.js';
import { CLICKS_PER_MINUTE, ShopClickRecorder, isBot } from '../src/shop/clicks.js';

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
const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

let pg: postgres.Sql;
let tpg: postgres.Sql;
let db: Database;
let app: FastifyInstance;
let recorder: ShopClickRecorder;
let productId = '';
let offProductId = '';

const click = (id: string, q = '', ua = BROWSER, ip = '10.9.8.7') =>
  app.inject({
    method: 'GET',
    url: `/go/shop/${id}${q}`,
    remoteAddress: ip,
    headers: { 'user-agent': ua, 'cf-ipcountry': 'br' },
  });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  tpg = postgres(testUrl, { max: 1, onnotice: () => {} });
  recorder = new ShopClickRecorder(db, { flushMs: 60_000 });
  app = buildServer({
    db,
    usagePersist: false,
    authenticator: { cacheTtlMs: 0 },
    shopSecretBox: box,
    shopClickRecorder: recorder,
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
  const base = { entityId, storeId: 'amazon_br', productType: 'home_kit', updatedBy: 'teste' };
  [productId, offProductId] = (
    await db
      .insert(shopProduct)
      .values([
        { ...base, storeProductId: 'B1', title: 'Camisa', url: 'https://a.example/dp/B1' },
        { ...base, storeProductId: 'B2', title: 'Boné', url: 'https://a.example/dp/B2', active: false },
      ])
      .returning({ id: shopProduct.id })
  ).map((r) => r.id) as [string, string];
}, 60_000);

afterAll(async () => {
  await app?.close();
  await tpg?.end();
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

const clicks = async () => {
  await recorder.flush();
  return tpg`select * from engage.shop_click order by clicked_at`;
};

describe('cliques do Shopping (#918)', () => {
  it('redireciona para a loja com a tag da Galaxie e grava o clique sem dado pessoal', async () => {
    const feedBefore = (await tpg`select count(*)::int as n from ops.change_feed`)[0]!.n;
    const res = await click(productId, `?origin=app&event=${eventId}&lang=pt-BR`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`https://a.example/dp/B1?tag=${TAG}`);
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = await clicks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_id: eventId,
      entity_kind: 'participant',
      entity_id: teamId,
      product_id: productId,
      store_id: 'amazon_br',
      origin: 'galaxie_app',
      tenant_id: null,
      country: 'BR',
      locale: 'pt-BR',
    });
    // nenhuma coluna guarda IP, agente ou torcedor
    expect(Object.keys(rows[0]!).filter((k) => /ip|agent|user|fan|email/.test(k))).toEqual([]);
    // clique nunca vira ponto: nada vai ao change feed (de onde a gamificação e as comunidades leem) nem à carteira
    expect((await tpg`select count(*)::int as n from ops.change_feed`)[0]!.n).toBe(feedBefore);
    const ledgers =
      await tpg`select table_name from information_schema.tables where table_schema = 'fan' and table_name like '%ledger%'`;
    for (const { table_name } of ledgers)
      expect((await tpg.unsafe(`select count(*)::int as n from fan."${table_name}"`))[0]!.n).toBe(0);
  });

  it('robô vai para a loja sem código e não conta', async () => {
    const before = (await clicks()).length;
    for (const ua of ['Googlebot/2.1', 'curl/8.4.0', 'facebookexternalhit/1.1', '']) {
      const res = await click(productId, '', ua);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://a.example/dp/B1');
    }
    expect((await clicks()).length).toBe(before);
    expect(isBot(BROWSER)).toBe(false);
  });

  it('acima do limite por origem: sem código e sem contar', async () => {
    const ip = '10.77.1.2';
    const before = (await clicks()).length;
    for (let i = 0; i < CLICKS_PER_MINUTE; i++)
      expect((await click(productId, '', BROWSER, ip)).statusCode).toBe(302);
    const over = await click(productId, '', BROWSER, ip);
    expect(over.headers.location).toBe('https://a.example/dp/B1');
    expect((await clicks()).length).toBe(before + CLICKS_PER_MINUTE);
  });

  it('produto desligado, inexistente ou id inválido: 404/400, sem redirecionar', async () => {
    expect((await click(offProductId)).statusCode).toBe(404);
    expect((await click(randomUUID())).statusCode).toBe(404);
    expect((await click('nao-e-uuid')).statusCode).toBe(400);
    expect((await click(productId, '?origin=client')).statusCode).toBe(400);
  });
});
