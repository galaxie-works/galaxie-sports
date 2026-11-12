import * as db from '@galaxie/db';
import { describe, expect, it } from 'vitest';

import {
  SHOP_ENTITY_KINDS,
  SHOP_LOOKUP_KINDS,
  SHOP_NETWORKS,
  SHOP_PRODUCT_STATUSES,
  SHOP_PRODUCT_TYPES,
  cleanHttpsUrl,
  isShopEntityRef,
  moveInOrder,
  parseConnectorInput,
  parseCredentialsInput,
  parseLookupInput,
  parseProductInput,
  parseProfileInput,
  parseStoreInput,
} from './catalog-input';

describe('entrada da curadoria do Shopping (#914)', () => {
  it('as listas são as mesmas do banco', () => {
    expect(SHOP_ENTITY_KINDS).toEqual(db.SHOP_ENTITY_KINDS);
    expect(SHOP_NETWORKS).toEqual(db.SHOP_NETWORKS);
    expect(SHOP_LOOKUP_KINDS).toEqual(db.SHOP_LOOKUP_KINDS);
    expect(SHOP_PRODUCT_TYPES).toEqual(db.SHOP_PRODUCT_TYPES);
    expect(SHOP_PRODUCT_STATUSES).toEqual(db.SHOP_PRODUCT_STATUSES);
  });

  it('link só https, sem credencial nem porta', () => {
    expect(cleanHttpsUrl(' https://loja.example/p/1 ')).toBe('https://loja.example/p/1');
    expect(cleanHttpsUrl('http://loja.example/p/1')).toBeNull();
    expect(cleanHttpsUrl('https://user:x@loja.example/')).toBeNull();
    expect(cleanHttpsUrl('https://loja.example:8443/')).toBeNull();
    expect(cleanHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(cleanHttpsUrl('')).toBeNull();
  });

  it('referência da entidade: tipo conhecido e uuid', () => {
    expect(isShopEntityRef('participant', '0190a0b1-0000-7000-8000-000000000001')).toBe(true);
    expect(isShopEntityRef('venue', '0190a0b1-0000-7000-8000-000000000001')).toBe(false);
    expect(isShopEntityRef('participant', '123')).toBe(false);
  });

  it('loja: id curto, país ISO e rede conhecida', () => {
    expect(
      parseStoreInput({ id: 'Loja_BR', name: 'Loja', country: 'br', network: 'awin', position: '3' }),
    ).toEqual({
      ok: true,
      value: { id: 'loja_br', name: 'Loja', country: 'BR', network: 'awin', homeUrl: null, position: 3 },
    });
    expect(parseStoreInput({ id: 'x', name: 'Loja', country: 'BR', network: 'awin' })).toEqual({
      ok: false,
      error: 'store_id',
    });
    expect(parseStoreInput({ id: 'loja', name: 'Loja', country: 'BRA', network: 'awin' })).toMatchObject({
      error: 'country',
    });
    expect(parseStoreInput({ id: 'loja', name: 'Loja', country: 'BR', network: 'ebay' })).toMatchObject({
      error: 'network',
    });
    expect(
      parseStoreInput({
        id: 'loja',
        name: 'Loja',
        country: 'BR',
        network: 'awin',
        homeUrl: 'http://x.example',
      }),
    ).toMatchObject({ error: 'url' });
  });

  it('ficha: temporada no formato 2026 ou 2025/26', () => {
    expect(parseProfileInput({ kitBrand: ' Marca ', kitSeason: '2025/26', reviewedSeason: '' })).toEqual({
      ok: true,
      value: { kitBrand: 'Marca', kitSeason: '2025/26', reviewedSeason: null },
    });
    expect(parseProfileInput({ kitSeason: '25/26' })).toMatchObject({ error: 'season' });
    expect(parseProfileInput({ kitBrand: 'M' })).toMatchObject({ error: 'kit_brand' });
  });

  it('jeito de achar na loja', () => {
    expect(
      parseLookupInput({ storeId: 'loja_br', lookupKind: 'official_seller', lookupValue: ' vendedor ' }),
    ).toEqual({
      ok: true,
      value: { storeId: 'loja_br', lookupKind: 'official_seller', lookupValue: 'vendedor', pageUrl: null },
    });
    expect(parseLookupInput({ storeId: 'loja_br', lookupKind: 'search', lookupValue: 'x' })).toMatchObject({
      error: 'lookup_kind',
    });
    expect(parseLookupInput({ storeId: 'loja_br', lookupKind: 'category', lookupValue: '' })).toMatchObject({
      error: 'lookup_value',
    });
  });

  it('produto: tipo, nome, temporada e link oficial', () => {
    const ok = {
      storeId: 'loja_br',
      storeProductId: 'MLB123',
      productType: 'home_kit',
      title: 'Camisa 1 2026',
      season: '2026',
      url: 'https://loja.example/p/MLB123',
    };
    expect(parseProductInput(ok)).toEqual({ ok: true, value: ok });
    expect(parseProductInput({ ...ok, productType: 'sticker' })).toMatchObject({ error: 'product_type' });
    expect(parseProductInput({ ...ok, title: 'C' })).toMatchObject({ error: 'title' });
    expect(parseProductInput({ ...ok, url: 'http://loja.example' })).toMatchObject({ error: 'url' });
    expect(parseProductInput({ ...ok, storeProductId: '' })).toMatchObject({ error: 'product_id' });
  });

  it('subir e descer na ordem', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 'up')).toBeNull();
    expect(moveInOrder(['a', 'b', 'c'], 'c', 'down')).toBeNull();
    expect(moveInOrder(['a'], 'z', 'up')).toBeNull();
  });

  it('conector: sub-rede só em rede que tem; anunciante e modelo do link conferidos', () => {
    expect(parseConnectorInput('amazon', { clientPaths: ['subnetwork'] })).toEqual({
      ok: false,
      error: 'subnetwork',
    });
    expect(parseConnectorInput('amazon', { clientPaths: ['client_code', 'outro'] })).toEqual({
      ok: true,
      value: { clientPaths: ['client_code'], config: {} },
    });
    expect(parseConnectorInput('awin', { clientPaths: ['subnetwork'], advertiserId: '123' })).toEqual({
      ok: true,
      value: { clientPaths: ['subnetwork'], config: { advertiserId: '123' } },
    });
    expect(parseConnectorInput('awin', { advertiserId: '1 2' })).toMatchObject({ error: 'advertiser_id' });
    expect(
      parseConnectorInput('impact', { linkTemplate: 'https://t.example/c?u={url}&s={clickref}' }),
    ).toMatchObject({
      ok: true,
    });
    expect(parseConnectorInput('impact', { linkTemplate: 'https://t.example/c' })).toMatchObject({
      error: 'link_template',
    });
    expect(parseConnectorInput('impact', { linkTemplate: 'http://t.example/{url}' })).toMatchObject({
      error: 'link_template',
    });
  });

  it('credenciais: código obrigatório e curto; token sem espaço', () => {
    expect(parseCredentialsInput({ affiliateId: ' galaxie-20 ', apiToken: 'abc' })).toEqual({
      ok: true,
      value: { affiliateId: 'galaxie-20', apiToken: 'abc' },
    });
    expect(parseCredentialsInput({ affiliateId: '' })).toMatchObject({ error: 'affiliate_id' });
    expect(parseCredentialsInput({ affiliateId: 'a&b' })).toMatchObject({ error: 'affiliate_id' });
    expect(parseCredentialsInput({ affiliateId: 'ok', apiToken: 'com espaco' })).toMatchObject({
      error: 'api_token',
    });
  });
});
