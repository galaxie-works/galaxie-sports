import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsShopEntity } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { ShopTheGame } from './widgets/shop-the-game.js';

afterEach(cleanup);

function setup(ui: ReactNode, fetchImpl: typeof fetch = createPreviewFetch()) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale="pt-BR"
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const W = PREVIEW_IDS.shopWidget;
const urls = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map(([input]) => new URL(String(input)));

describe('widget Shopping (#925)', () => {
  it('no jogo: uma coluna por time, pela rota presa ao widget, com o aviso de parceiro', async () => {
    const spy = vi.fn(createPreviewFetch());
    const { container } = setup(<ShopTheGame widgetId={W} eventId={PREVIEW_IDS.scheduledEvent} />, spy);
    await waitFor(() => expect(container.querySelectorAll('.gs-shop-col')).toHaveLength(2));
    const shop = urls(spy).filter((u) => u.pathname.endsWith('/shop'));
    expect(shop.every((u) => u.pathname === `/v1/widgets/${W}/shop`)).toBe(true);
    expect(shop.every((u) => u.searchParams.get('event') === PREVIEW_IDS.scheduledEvent)).toBe(true);
    expect(new Set(shop.map((u) => u.searchParams.get('entity'))).size).toBe(2);
    // 4 por time (padrão), na ordem das lojas
    const first = container.querySelectorAll('.gs-shop-col')[0]!;
    expect(first.querySelectorAll('.gs-shop-item')).toHaveLength(4);
    expect(first.textContent).toContain('Produtos do');
    const buy = first.querySelector('a.gs-button')!;
    expect(buy.getAttribute('target')).toBe('_blank');
    expect(buy.getAttribute('rel')).toContain('sponsored');
    expect(screen.getByText(/podemos receber comissão/)).toBeTruthy();
  });

  it('fora do jogo: o time da página; perTeam limita e o preço some quando desligado', async () => {
    const { container } = setup(
      <ShopTheGame widgetId={W} teamId={PREVIEW_IDS.team} perTeam={3} showPrice={false} />,
    );
    await waitFor(() => expect(container.querySelectorAll('.gs-shop-item')).toHaveLength(3));
    expect(container.textContent).not.toContain('R$');
  });

  it('TV (loja só em QR): produto sem botão; sem produto em nenhuma coluna, um aviso só e sem aviso de parceiro', async () => {
    const tv: GsShopEntity = {
      entity: { kind: 'participant', id: PREVIEW_IDS.team },
      stores: [
        {
          store: { id: 'a', name: 'Loja A', country: 'BR' },
          display: 'qr',
          products: [
            {
              id: 'p1',
              product_type: 'home_kit',
              title: 'Camisa I',
              season: null,
              price: null,
              currency: null,
              image_url: null,
              fetched_at: null,
              source: 'curated',
              buy_url: 'https://api.exemplo.test/go/shop/p1',
            },
          ],
        },
      ],
      disclosure: 'affiliate',
    };
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
    const { container } = setup(<ShopTheGame widgetId={W} teamId={PREVIEW_IDS.team} />, (async () =>
      json(tv)) as typeof fetch);
    await waitFor(() => expect(container.querySelector('.gs-shop-item')).toBeTruthy());
    expect(container.querySelector('a.gs-button')).toBeNull();
    expect(container.textContent).toContain('Na loja Loja A');

    cleanup();
    const empty = setup(<ShopTheGame widgetId={W} teamId={PREVIEW_IDS.team} />, (async () =>
      json({ ...tv, stores: [] })) as typeof fetch);
    expect(await screen.findByText('Nenhum produto oficial disponível agora.')).toBeTruthy();
    expect(empty.container.textContent).not.toContain('comissão');
  });

  it('falha da API não vira catálogo vazio: a coluna mostra o erro', async () => {
    const { container } = setup(
      <ShopTheGame widgetId={W} teamId={PREVIEW_IDS.team} />,
      (async () => new Response('{}', { status: 503 })) as typeof fetch,
    );
    await waitFor(() => expect(container.querySelector('.gs-shop button')).toBeTruthy());
    expect(container.textContent).not.toContain('Nenhum produto oficial');
  });

  it('catálogo e opções: preso ao widget, 3 a 6 produtos por time', () => {
    expect(WIDGET_CATALOG.shop_the_game.requiredProps).toEqual(['widgetId']);
    expect(parseWidgetOptions('shop_the_game', { perTeam: 9, showPrice: false })).toMatchObject({
      showPrice: false,
    });
    expect(parseWidgetOptions('shop_the_game', { perTeam: 5 })).toMatchObject({ perTeam: 5 });
  });
});
