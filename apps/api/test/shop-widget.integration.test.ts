import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  runMigrations,
  saveWidget,
  shopEntity,
  shopProduct,
  shopStore,
  type Database,
  type WidgetConfig,
} from '@galaxie/db';
import { SHOP_DESTINATION_RULES_VERSION, shopStoreSecretKey } from '@galaxie/engage';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';
import { ShopClickRecorder } from '../src/shop/clicks.js';
import { ShopClickSigner } from '../src/shop/click-token.js';
import { tenantClickref } from '../src/shop/widget.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const box = new SettingsSecretBox(['k'.repeat(40)]);
const signer = new ShopClickSigner('s'.repeat(40));
const teamId = randomUUID();
const GALAXIE_TAG = 'galaxie-tag-20';
const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

let pg: postgres.Sql;
let tpg: postgres.Sql;
let db: Database;
let app: FastifyInstance;
let recorder: ShopClickRecorder;
let tenantId = '';
let key = '';
let otherKey = '';
let widgetId = '';
let staleWidgetId = '';

const base: Omit<WidgetConfig, 'shop'> = {
  theme: {
    primary: '#0a84ff',
    background: '#ffffff',
    surface: '#f5f5f7',
    foreground: '#111111',
    mutedForeground: '#6b7280',
    border: '#e5e7eb',
    radius: 12,
    fontFamily: 'Inter, sans-serif',
    density: 'compact',
    mode: 'light',
  },
  locale: 'pt-BR',
  market: 'BR',
  defaults: { teamId },
} as Omit<WidgetConfig, 'shop'>;
const answers = { ownSite: true, mobileApp: false, smartTv: false, under13: false, rewardsArea: false };

const get = (url: string, k = key) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': k } });

beforeAll(async () => {
  pg = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await pg.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  tpg = postgres(testUrl, { max: 1, onnotice: () => {} });
  recorder = new ShopClickRecorder(db, { flushMs: 60_000 });

  const modules = ['core_data', 'shopping'] as ('core_data' | 'shopping')[];
  tenantId = (await upsertTenant(db, { slug: 'portal-x', name: 'Portal', plan: 'enterprise', modules })).id;
  const other = (await upsertTenant(db, { slug: 'portal-y', name: 'Outro', plan: 'enterprise', modules })).id;
  key = (await createApiKey(db, tenantId, { env: 'test' })).key;
  otherKey = (await createApiKey(db, other, { env: 'test' })).key;

  app = buildServer({
    db,
    usagePersist: false,
    authenticator: { cacheTtlMs: 0 },
    publicUrl: 'https://api.example',
    shopSecretBox: box,
    shopClickSigner: signer,
    shopClickRecorder: recorder,
  });
  await app.ready();

  const seal = (id: string) => box.seal(shopStoreSecretKey(id), JSON.stringify({ affiliateId: GALAXIE_TAG }));
  await db.insert(shopStore).values([
    {
      id: 'amazon_br',
      name: 'Loja A',
      country: 'BR',
      network: 'amazon',
      active: true,
      clientPaths: ['client_code'],
      credentialsSealed: seal('amazon_br'),
      updatedBy: 'teste',
    },
    {
      id: 'awin_br',
      name: 'Loja B',
      country: 'BR',
      network: 'awin',
      active: true,
      position: 1,
      clientPaths: ['subnetwork'],
      config: { advertiserId: '555' },
      credentialsSealed: seal('awin_br'),
      updatedBy: 'teste',
    },
  ]);
  const entityId = (
    await db
      .insert(shopEntity)
      .values({ entityKind: 'participant', entityId: teamId, updatedBy: 'teste' })
      .returning({ id: shopEntity.id })
  )[0]!.id;
  const p = { entityId, productType: 'home_kit', updatedBy: 'teste' };
  await db.insert(shopProduct).values([
    { ...p, storeId: 'amazon_br', storeProductId: 'B1', title: 'Camisa A', url: 'https://a.example/dp/B1' },
    { ...p, storeId: 'awin_br', storeProductId: 'W1', title: 'Camisa B', url: 'https://b.example/p/W1' },
  ]);

  const shop = {
    // a ordem do cliente: a Awin antes da Amazon
    stores: [
      { storeId: 'awin_br', path: 'subnetwork' as const },
      { storeId: 'amazon_br', path: 'client_code' as const, clientCode: 'cliente-21' },
    ],
    destination: {
      answers,
      rulesVersion: SHOP_DESTINATION_RULES_VERSION,
      confirmedAt: '2026-11-12T00:00:00Z',
    },
  };
  widgetId = (
    await saveWidget(db, {
      tenantId,
      kind: 'shop_the_game',
      name: 'Shopping',
      config: { ...base, shop } as WidgetConfig,
      createdBy: 'teste',
    })
  ).id;
  staleWidgetId = (
    await saveWidget(db, {
      tenantId,
      kind: 'shop_the_game',
      name: 'Shopping antigo',
      config: {
        ...base,
        shop: {
          ...shop,
          destination: { ...shop.destination, rulesVersion: SHOP_DESTINATION_RULES_VERSION - 1 },
        },
      } as WidgetConfig,
      createdBy: 'teste',
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await tpg?.end();
  if (db) await closeDb(db);
  await pg.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await pg.end();
});

const shopUrl = (w: string) => `/v1/widgets/${w}/shop?kind=participant&entity=${teamId}`;

describe('widget do Shopping no site do cliente (#925)', () => {
  it('lojas do cliente na ordem dele, link assinado do widget, sem o código da Galaxie', async () => {
    const res = await get(shopUrl(widgetId));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stores.map((s: { store: { id: string } }) => s.store.id)).toEqual(['awin_br', 'amazon_br']);
    expect(JSON.stringify(body)).not.toContain(GALAXIE_TAG);
    const buy = new URL(body.stores[1].products[0].buy_url);
    expect(buy.searchParams.get('origin')).toBe('client');
    expect(buy.searchParams.get('w')).toBe(widgetId);
  });

  it('o clique do widget leva o código do cliente ou o clickref dele, e grava o cliente', async () => {
    const body = (await get(shopUrl(widgetId))).json();
    const awin = new URL(body.stores[0].products[0].buy_url);
    const amazon = new URL(body.stores[1].products[0].buy_url);
    const go = (u: URL) =>
      app.inject({
        method: 'GET',
        url: `${u.pathname}${u.search}`,
        remoteAddress: '10.2.2.2',
        headers: { 'user-agent': BROWSER },
      });
    const a = await go(amazon);
    expect(a.statusCode).toBe(302);
    expect(a.headers.location).toBe('https://a.example/dp/B1?tag=cliente-21');
    const w = new URL((await go(awin)).headers.location as string);
    expect(w.searchParams.get('awinaffid')).toBe(GALAXIE_TAG);
    expect(w.searchParams.get('clickref')).toBe(tenantClickref(tenantId));
    await recorder.flush();
    const rows = await tpg`select origin, tenant_id, widget_id from engage.shop_click order by clicked_at`;
    expect(rows).toEqual([
      { origin: 'client', tenant_id: tenantId, widget_id: widgetId },
      { origin: 'client', tenant_id: tenantId, widget_id: widgetId },
    ]);
  });

  it('link do widget com origem trocada para a Galaxie não leva o código da Galaxie', async () => {
    const body = (await get(shopUrl(widgetId))).json();
    const u = new URL(body.stores[1].products[0].buy_url);
    u.searchParams.set('origin', 'site');
    u.searchParams.delete('w');
    const res = await app.inject({
      method: 'GET',
      url: `${u.pathname}${u.search}`,
      headers: { 'user-agent': BROWSER },
    });
    expect(res.headers.location).toBe('https://a.example/dp/B1');
  });

  it('checagem de destino de versão antiga: nenhuma loja', async () => {
    expect((await get(shopUrl(staleWidgetId))).json().stores).toEqual([]);
  });

  it('widget de outro tenant: 404', async () => {
    expect((await get(shopUrl(widgetId), otherKey)).statusCode).toBe(404);
  });
});
