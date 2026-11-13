import { describe, expect, it } from 'vitest';

import { parseShopConfig, parseWidgetInput } from './config';

const answers = { ownSite: true, mobileApp: false, smartTv: false, under13: false, rewardsArea: false };
const destination = { answers, rulesVersion: 1, confirmedAt: '2026-11-12T10:00:00.000Z' };

describe('configuração do Shopping no Builder (#925)', () => {
  it('guarda lojas válidas na ordem do cliente, sem repetir; código inválido tira a loja', () => {
    expect(
      parseShopConfig({
        stores: [
          { storeId: 'awin_br', path: 'subnetwork', clientCode: 'ignorado' },
          { storeId: 'amazon_br', path: 'client_code', clientCode: ' cliente-21 ' },
          { storeId: 'awin_br', path: 'client_code', clientCode: 'x' },
          { storeId: 'outra_br', path: 'client_code', clientCode: 'a b' },
          { storeId: 'Fora!', path: 'subnetwork' },
          { storeId: 'ml_br', path: 'galaxie' },
        ],
        destination,
      }),
    ).toEqual({
      stores: [
        { storeId: 'awin_br', path: 'subnetwork' },
        { storeId: 'amazon_br', path: 'client_code', clientCode: 'cliente-21' },
      ],
      destination,
    });
  });

  it('checagem incompleta não entra; nada válido = sem configuração', () => {
    const partial = { ...destination, answers: { ...answers, smartTv: undefined } };
    expect(parseShopConfig({ stores: [{ storeId: 'a', path: 'subnetwork' }], destination: partial })).toEqual(
      {
        stores: [{ storeId: 'a', path: 'subnetwork' }],
      },
    );
    expect(parseShopConfig({ stores: [], destination: { ...destination, rulesVersion: 0 } })).toBeUndefined();
    expect(parseShopConfig(null)).toBeUndefined();
  });

  it('só o widget do Shopping leva a configuração para o banco', () => {
    const config = {
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
      defaults: {},
      shop: { stores: [{ storeId: 'awin_br', path: 'subnetwork' }], destination },
    };
    const opts = { markets: [], entityTypes: () => ['event', 'team', 'competition', 'person'] as const };
    const shop = parseWidgetInput({ kind: 'shop_the_game', name: 'Loja', config }, opts);
    expect(shop.ok && shop.value.config.shop?.stores).toHaveLength(1);
    const other = parseWidgetInput({ kind: 'channel_guide', name: 'Grade', config }, opts);
    expect(other.ok && other.value.config.shop).toBeUndefined();
  });
});
