import { describe, expect, it } from 'vitest';

import {
  buildAffiliateLink,
  connectorFor,
  curatedConnector,
  mercadoLivreConnector,
  offerFresh,
  priceCacheHours,
  visibleOffers,
  type ShopDestination,
  type ShopFetch,
  type ShopOffer,
  type ShopStoreConnector,
} from './shop.js';

const GALAXIE_TAG = 'galaxie-20';

const store = (over: Partial<ShopStoreConnector> = {}): ShopStoreConnector => ({
  id: 'loja_br',
  network: 'amazon',
  active: true,
  clientPaths: [],
  config: {},
  credentials: { affiliateId: GALAXIE_TAG },
  ...over,
});
const product = { url: 'https://loja.example/dp/B0001?ref=x' };
const galaxie: ShopDestination = { kind: 'galaxie' };
const client = (over: Partial<Extract<ShopDestination, { kind: 'client' }>> = {}): ShopDestination => ({
  kind: 'client',
  tenantId: 't1',
  path: 'client_code',
  clientCode: 'cliente-20',
  clickref: 'cli_t1',
  ...over,
});

describe('link de afiliado (#916)', () => {
  it('Amazon no site Galaxie leva a tag da Galaxie', () => {
    const r = buildAffiliateLink(store(), product, galaxie);
    expect(r).toEqual({ ok: true, url: 'https://loja.example/dp/B0001?ref=x&tag=galaxie-20' });
  });

  it('a tag da Galaxie nunca vai para destino de cliente, em nenhuma rede e caminho', () => {
    const networks = ['amazon', 'awin', 'direct', 'impact', 'mercado_livre'] as const;
    for (const network of networks)
      for (const path of ['client_code', 'subnetwork'] as const)
        for (const clientPaths of [
          [],
          ['client_code'],
          ['subnetwork'],
          ['client_code', 'subnetwork'],
        ] as const) {
          const s = store({
            network,
            clientPaths,
            config: {
              advertiserId: '1234',
              linkTemplate: 'https://track.example/c/{code}?u={url}&s={clickref}',
            },
          });
          const r = buildAffiliateLink(s, product, client({ path }));
          if (!r.ok) continue;
          const u = new URL(r.url);
          // no caminho do código do cliente, a tag da Galaxie não aparece em lugar nenhum do link
          if (path === 'client_code') expect(r.url, `${network}/${path}`).not.toContain(GALAXIE_TAG);
          // sub-rede: só com repasse (nunca Amazon nem Mercado Livre) e sempre com o clickref do cliente
          if (path === 'subnetwork') {
            expect(['awin', 'impact', 'direct']).toContain(network);
            expect(r.url).toContain('cli_t1');
          }
          expect(u.protocol).toBe('https:');
        }
  });

  it('cliente sem caminho liberado, sem código ou loja desligada: sem link', () => {
    expect(buildAffiliateLink(store(), product, client())).toEqual({ ok: false, reason: 'path_not_allowed' });
    expect(
      buildAffiliateLink(store({ clientPaths: ['client_code'] }), product, client({ clientCode: null })),
    ).toEqual({
      ok: false,
      reason: 'missing_code',
    });
    expect(buildAffiliateLink(store({ active: false }), product, galaxie)).toEqual({
      ok: false,
      reason: 'store_off',
    });
    // Amazon não tem sub-rede, mesmo que a matriz diga que sim
    expect(
      buildAffiliateLink(store({ clientPaths: ['subnetwork'] }), product, client({ path: 'subnetwork' })),
    ).toEqual({ ok: false, reason: 'path_not_allowed' });
  });

  it('código do cliente na Amazon usa a tag dele', () => {
    const r = buildAffiliateLink(store({ clientPaths: ['client_code'] }), product, client());
    expect(r).toEqual({ ok: true, url: 'https://loja.example/dp/B0001?ref=x&tag=cliente-20' });
  });

  it('Awin: deeplink com anunciante, publisher da Galaxie e clickref do cliente na sub-rede', () => {
    const s = store({ network: 'awin', clientPaths: ['subnetwork'], config: { advertiserId: '9876' } });
    const r = buildAffiliateLink(s, product, client({ path: 'subnetwork' }));
    expect(r.ok).toBe(true);
    const u = new URL((r as { url: string }).url);
    expect(u.origin + u.pathname).toBe('https://www.awin1.com/cread.php');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      awinmid: '9876',
      awinaffid: GALAXIE_TAG,
      clickref: 'cli_t1',
      ued: product.url,
    });
    expect(buildAffiliateLink(store({ network: 'awin' }), product, galaxie)).toEqual({
      ok: false,
      reason: 'missing_credentials',
    });
  });

  it('Mercado Livre: matt_word e matt_tool', () => {
    const s = store({
      network: 'mercado_livre',
      credentials: { affiliateId: 'galaxie', affiliateTool: '123' },
    });
    const r = buildAffiliateLink(s, { url: 'https://produto.example/MLB-1' }, galaxie);
    expect(r).toEqual({ ok: true, url: 'https://produto.example/MLB-1?matt_word=galaxie&matt_tool=123' });
  });

  it('Impact: preenche o modelo do programa; sem modelo, sem link', () => {
    const s = store({
      network: 'impact',
      config: { linkTemplate: 'https://track.example/c/{code}?u={url}&s={clickref}' },
    });
    const r = buildAffiliateLink(s, product, galaxie);
    expect(r).toEqual({
      ok: true,
      url: `https://track.example/c/galaxie-20?u=${encodeURIComponent(product.url)}&s=`,
    });
    expect(buildAffiliateLink(store({ network: 'impact' }), product, galaxie)).toMatchObject({ ok: false });
  });

  it('link do produto sem https ou código estranho: recusa', () => {
    expect(buildAffiliateLink(store(), { url: 'http://loja.example/x' }, galaxie)).toEqual({
      ok: false,
      reason: 'bad_url',
    });
    expect(buildAffiliateLink(store({ credentials: { affiliateId: 'a&b=c' } }), product, galaxie)).toEqual({
      ok: false,
      reason: 'missing_credentials',
    });
  });
});

describe('cache de preço e exibição', () => {
  it('teto de 24 h; valor estranho volta ao teto', () => {
    expect(priceCacheHours(6)).toBe(6);
    expect(priceCacheHours(48)).toBe(24);
    expect(priceCacheHours('x')).toBe(24);
    expect(priceCacheHours(0)).toBe(24);
  });

  it('oferta vale dentro do cache', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(offerFresh({ fetchedAt: '2026-11-12T00:00:01Z' }, now, 12)).toBe(true);
    expect(offerFresh({ fetchedAt: '2026-11-11T11:00:00Z' }, now, 48)).toBe(false);
    expect(offerFresh({ fetchedAt: null }, now, 24)).toBe(false);
  });

  it('sem estoque ou sem preço da loja, some; curado aparece', () => {
    const base: ShopOffer = {
      productId: 'p',
      title: 't',
      price: 10,
      currency: 'BRL',
      available: true,
      imageUrl: null,
      fetchedAt: 'x',
      source: 'live',
    };
    const list = [
      base,
      { ...base, productId: 'sem-estoque', available: false },
      { ...base, productId: 'sem-preco', price: null },
      { ...base, productId: 'curado', price: null, source: 'curated' as const },
    ];
    expect(visibleOffers(list).map((o) => o.productId)).toEqual(['p', 'curado']);
  });
});

describe('conectores', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const refs = [
    { id: 'a', storeProductId: 'MLB111', title: 'Camisa', url: 'https://produto.example/MLB-111' },
    { id: 'b', storeProductId: 'mlb222', title: 'Caneca', url: 'https://produto.example/MLB-222' },
    { id: 'c', storeProductId: 'XYZ', title: 'Fora', url: 'https://produto.example/x' },
  ];

  it('curado: nome e link, sem preço nem imagem', async () => {
    const offers = await curatedConnector.offers(store(), refs.slice(0, 1), now);
    expect(offers).toEqual([
      {
        productId: 'a',
        title: 'Camisa',
        price: null,
        currency: null,
        available: true,
        imageUrl: null,
        fetchedAt: null,
        source: 'curated',
      },
    ]);
  });

  it('Mercado Livre pela API: preço, estoque e imagem da loja', async () => {
    const calls: string[] = [];
    const fetchFn: ShopFetch = async (url, init) => {
      calls.push(url);
      expect(init.headers.authorization).toBe('Bearer tok');
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            code: 200,
            body: {
              id: 'MLB111',
              title: 'Camisa oficial',
              price: 349.9,
              currency_id: 'BRL',
              available_quantity: 3,
              status: 'active',
              pictures: [{ secure_url: 'https://img.example/1.jpg' }],
            },
          },
          {
            code: 200,
            body: { id: 'MLB222', title: 'Caneca', price: 50, available_quantity: 0, status: 'active' },
          },
        ],
      };
    };
    const s = store({ network: 'mercado_livre', credentials: { apiToken: 'tok' } });
    const offers = await mercadoLivreConnector(fetchFn, { baseUrl: 'https://api.example' }).offers(
      s,
      refs,
      now,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('ids=MLB111,MLB222&');
    expect(offers).toEqual([
      {
        productId: 'a',
        title: 'Camisa oficial',
        price: 349.9,
        currency: 'BRL',
        available: true,
        imageUrl: 'https://img.example/1.jpg',
        fetchedAt: now.toISOString(),
        source: 'live',
      },
      expect.objectContaining({ productId: 'b', available: false, imageUrl: null }),
    ]);
  });

  it('Mercado Livre sem token cai no curado; erro da API sobe', async () => {
    const never: ShopFetch = async () => {
      throw new Error('não devia chamar');
    };
    const s = store({ network: 'mercado_livre', credentials: { affiliateId: 'x' } });
    expect(
      (await mercadoLivreConnector(never).offers(s, refs, now)).every((o) => o.source === 'curated'),
    ).toBe(true);
    const fail: ShopFetch = async () => ({ ok: false, status: 503, json: async () => null });
    await expect(
      mercadoLivreConnector(fail).offers({ ...s, credentials: { apiToken: 't' } }, refs, now),
    ).rejects.toThrow('503');
  });

  it('Amazon e Awin ficam no curado até a conta liberar a API', () => {
    const f: ShopFetch = async () => ({ ok: true, status: 200, json: async () => [] });
    expect(connectorFor('amazon', f).mode).toBe('curated');
    expect(connectorFor('awin', f).mode).toBe('curated');
    expect(connectorFor('mercado_livre', f).mode).toBe('live');
  });
});
