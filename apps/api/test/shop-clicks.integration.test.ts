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
import { ShopClickSigner } from '../src/shop/click-token.js';
import { CLICKS_PER_MINUTE, ShopClickRecorder, isBot, originKey } from '../src/shop/clicks.js';

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

const signer = new ShopClickSigner('s'.repeat(40));
/** Link como a vitrine da Galaxie monta: com a assinatura do produto e da origem. */
const signed = (id: string, q: string) => {
  const origin = /origin=app/.test(q) ? 'app' : 'site';
  const t = signer.sign(id, origin, new Date())!;
  return `${q}${q ? '&' : '?'}t=${encodeURIComponent(t)}`;
};
const click = (id: string, q = '', ua = BROWSER, ip = '10.9.8.7', sign = true) =>
  app.inject({
    method: 'GET',
    url: `/go/shop/${id}${sign ? signed(id, q) : q}`,
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
    shopClickSigner: signer,
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
      // o jogo não existe no core: não infla a estatística
      event_id: null,
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

  it('HEAD não é rota (verificador de link não conta clique)', async () => {
    const before = (await clicks()).length;
    const res = await app.inject({
      method: 'HEAD',
      url: `/go/shop/${productId}`,
      headers: { 'user-agent': BROWSER },
    });
    expect(res.statusCode).toBe(404);
    expect((await clicks()).length).toBe(before);
  });

  it('pré-carregamento do navegador vai sem código e não conta', async () => {
    const before = (await clicks()).length;
    const res = await app.inject({
      method: 'GET',
      url: `/go/shop/${productId}`,
      remoteAddress: '10.5.5.5',
      headers: { 'user-agent': BROWSER, 'sec-purpose': 'prefetch' },
    });
    expect(res.headers.location).toBe('https://a.example/dp/B1');
    expect((await clicks()).length).toBe(before);
  });

  it('idioma fora do formato não quebra o redirecionamento', async () => {
    const res = await click(productId, '?lang=xx_YY_zz', BROWSER, '10.6.6.6');
    expect(res.statusCode).toBe(302);
  });

  it('chave da origem: /24 no IPv4, /64 no IPv6, IPv4 mapeado igual ao IPv4', () => {
    expect(originKey('10.1.2.3')).toBe(originKey('10.1.2.99'));
    expect(originKey('10.1.2.3')).not.toBe(originKey('10.1.3.3'));
    expect(originKey('::ffff:10.1.2.3')).toBe(originKey('10.1.2.200'));
    expect(originKey('2001:db8::1')).toBe(originKey('2001:0db8:0:0:ffff::2'));
    expect(originKey('2001:db8::1')).not.toBe(originKey('2001:db8:0:1::1'));
  });
});

describe('fila de cliques', () => {
  it('lote que falha volta à fila e é gravado na tentativa seguinte; flushes não correm juntos', async () => {
    let fail = true;
    const errors: unknown[] = [];
    const fake = {
      insert: () => ({
        values: async () => {
          if (fail) {
            fail = false;
            throw new Error('banco fora');
          }
        },
      }),
    } as unknown as Database;
    const r = new ShopClickRecorder(fake, { flushMs: 60_000, onError: (e) => errors.push(e) });
    const row = {
      entityKind: 'participant',
      entityId: teamId,
      productId,
      storeId: 'amazon_br',
      origin: 'galaxie_site',
    };
    r.add(row);
    await Promise.all([r.flush(), r.flush(), r.flush()]);
    expect(errors).toHaveLength(1);
    await r.close();
    expect(errors).toHaveLength(1);
  });

  it('link sem assinatura, adulterado ou de outro produto: sem código e sem contar (#921)', async () => {
    const before = (await clicks()).length;
    const plainUrl = 'https://a.example/dp/B1';
    expect((await click(productId, '', BROWSER, '10.8.1.1', false)).headers.location).toBe(plainUrl);
    expect(
      (await click(productId, '?t=9999999999.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', BROWSER, '10.8.1.2', false))
        .headers.location,
    ).toBe(plainUrl);
    // assinatura de outro produto não vale para este
    const other = signer.sign(offProductId, 'site', new Date())!;
    expect(
      (await click(productId, `?t=${encodeURIComponent(other)}`, BROWSER, '10.8.1.3', false)).headers
        .location,
    ).toBe(plainUrl);
    // assinatura do site não vale para o app
    const site = signer.sign(productId, 'site', new Date())!;
    expect(
      (await click(productId, `?origin=app&t=${encodeURIComponent(site)}`, BROWSER, '10.8.1.4', false))
        .headers.location,
    ).toBe(plainUrl);
    // vencida
    const old = signer.sign(productId, 'site', new Date(Date.now() - 48 * 3_600_000))!;
    expect(
      (await click(productId, `?t=${encodeURIComponent(old)}`, BROWSER, '10.8.1.5', false)).headers.location,
    ).toBe(plainUrl);
    expect((await clicks()).length).toBe(before);
  });
});
