// Dados de exemplo do Shopping no site do cliente (`/v1/widgets/{id}/shop`) para a prévia do Builder: lojas e
// produtos fictícios, sem imagem e sem link de verdade (a prévia não leva a loja nenhuma).
import type { GsShopEntity, GsShopEntityKind } from './core/model.js';

const KINDS: readonly GsShopEntityKind[] = ['competition', 'participant', 'person'];

const PRODUCTS: readonly [type: string, title: string, price: number][] = [
  ['home_kit', 'Camisa I', 349.9],
  ['away_kit', 'Camisa II', 349.9],
  ['training', 'Camisa de treino', 229.9],
  ['cap', 'Boné oficial', 129.9],
  ['scarf', 'Cachecol', 99.9],
  ['mug', 'Caneca', 59.9],
];

/** Corpo de `/v1/widgets/{id}/shop` com produtos de exemplo, ou null se a rota é outra. */
export function shopPreviewBody(url: URL, now: Date): GsShopEntity | null {
  if (!/\/v1\/widgets\/[^/]+\/shop$/.test(url.pathname.replace(/\/+$/, ''))) return null;
  const kind = url.searchParams.get('kind') as GsShopEntityKind | null;
  const id = url.searchParams.get('entity') ?? '';
  const fetchedAt = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  const product = ([type, title, price]: (typeof PRODUCTS)[number], i: number) => ({
    id: `${id.slice(0, 30)}-${i}`,
    product_type: type,
    title,
    season: null,
    price,
    currency: 'BRL',
    image_url: null,
    fetched_at: fetchedAt,
    source: 'live' as const,
    buy_url: '#',
  });
  return {
    entity: { kind: kind && KINDS.includes(kind) ? kind : 'participant', id },
    stores: [
      {
        store: { id: 'preview_a', name: 'Loja parceira A', country: 'BR' },
        display: 'link',
        products: PRODUCTS.slice(0, 3).map(product),
      },
      {
        store: { id: 'preview_b', name: 'Loja parceira B', country: 'BR' },
        display: 'link',
        products: PRODUCTS.slice(3).map((p, i) => product(p, i + 3)),
      },
    ],
    disclosure: 'affiliate',
  };
}
