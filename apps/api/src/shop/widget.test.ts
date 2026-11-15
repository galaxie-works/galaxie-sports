import { SHOP_DESTINATION_RULES_VERSION, type ShopStoreConnector } from '@galaxie/engage';
import type { WidgetShopConfig } from '@galaxie/db';
import { describe, expect, it } from 'vitest';

import { tenantClickref, widgetShopDestinations, widgetStoreOrder } from './widget.js';

const TENANT = '0190a0b1-0000-7000-8000-000000000001';
const connector = (id: string, over: Partial<ShopStoreConnector> = {}): ShopStoreConnector => ({
  id,
  network: 'awin',
  active: true,
  clientPaths: ['client_code', 'subnetwork'],
  config: { advertiserId: '1' },
  credentials: { affiliateId: 'galaxie-20' },
  ...over,
});
const stores = new Map<string, ShopStoreConnector>([
  ['awin_br', connector('awin_br')],
  ['amazon_br', connector('amazon_br', { network: 'amazon', clientPaths: ['client_code'] })],
  ['off_br', connector('off_br', { active: false })],
]);
const answers = { ownSite: true, mobileApp: false, smartTv: false, under13: false, rewardsArea: false };
const config = (over: Partial<WidgetShopConfig> = {}): WidgetShopConfig => ({
  stores: [
    { storeId: 'amazon_br', path: 'client_code', clientCode: 'cliente-21' },
    { storeId: 'awin_br', path: 'subnetwork' },
    { storeId: 'off_br', path: 'subnetwork' },
  ],
  destination: { answers, rulesVersion: SHOP_DESTINATION_RULES_VERSION, confirmedAt: '2026-11-12T00:00:00Z' },
  ...over,
});

describe('destinos do widget do Shopping (#925)', () => {
  it('cada loja com o caminho do cliente; loja desligada fica de fora; nunca o código da Galaxie', () => {
    const d = widgetShopDestinations(TENANT, config(), stores);
    expect([...d.keys()]).toEqual(['amazon_br', 'awin_br']);
    expect(d.get('amazon_br')!.dest).toEqual({
      kind: 'client',
      tenantId: TENANT,
      path: 'client_code',
      clientCode: 'cliente-21',
    });
    expect(d.get('awin_br')!.dest).toEqual({
      kind: 'client',
      tenantId: TENANT,
      path: 'subnetwork',
      clickref: tenantClickref(TENANT),
    });
    for (const v of d.values()) expect(v.dest.kind).toBe('client');
  });

  it('sem checagem, com versão antiga ou sem configuração: nenhuma loja', () => {
    expect(widgetShopDestinations(TENANT, { stores: config().stores }, stores).size).toBe(0);
    expect(
      widgetShopDestinations(
        TENANT,
        config({
          destination: { answers, rulesVersion: SHOP_DESTINATION_RULES_VERSION - 1, confirmedAt: 'x' },
        }),
        stores,
      ).size,
    ).toBe(0);
    expect(widgetShopDestinations(TENANT, undefined, stores).size).toBe(0);
  });

  it('caminho que a matriz da Galaxie não libera ou código inválido: fora', () => {
    const d = widgetShopDestinations(
      TENANT,
      config({
        stores: [
          { storeId: 'amazon_br', path: 'subnetwork' },
          { storeId: 'awin_br', path: 'client_code', clientCode: 'a b' },
        ],
      }),
      stores,
    );
    expect(d.size).toBe(0);
  });

  it('a checagem de destino manda: TV sem Amazon e só QR; criança sem Shopping; sem site, só sub-rede', () => {
    const tv = widgetShopDestinations(
      TENANT,
      config({
        destination: {
          answers: { ...answers, smartTv: true },
          rulesVersion: SHOP_DESTINATION_RULES_VERSION,
          confirmedAt: 'x',
        },
      }),
      new Map([...stores].map(([k, v]) => [k, v])),
    );
    expect(tv.has('amazon_br')).toBe(false);
    const kids = widgetShopDestinations(
      TENANT,
      config({
        destination: {
          answers: { ...answers, under13: true },
          rulesVersion: SHOP_DESTINATION_RULES_VERSION,
          confirmedAt: 'x',
        },
      }),
      stores,
    );
    expect(kids.size).toBe(0);
    const noSite = widgetShopDestinations(
      TENANT,
      config({
        destination: {
          answers: { ...answers, ownSite: false },
          rulesVersion: SHOP_DESTINATION_RULES_VERSION,
          confirmedAt: 'x',
        },
      }),
      stores,
    );
    expect([...noSite.keys()]).toEqual(['awin_br']);
  });

  it('clickref estável por cliente e sem o id à mostra; ordem do cliente', () => {
    expect(tenantClickref(TENANT)).toBe(tenantClickref(TENANT.toUpperCase()));
    expect(tenantClickref(TENANT)).not.toContain(TENANT.slice(0, 8));
    expect(tenantClickref(TENANT)).toMatch(/^gs[0-9a-f]{14}$/);
    expect([...widgetStoreOrder(config())]).toEqual([
      ['amazon_br', 0],
      ['awin_br', 1],
      ['off_br', 2],
    ]);
  });
});
