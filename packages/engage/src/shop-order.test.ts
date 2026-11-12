import { describe, expect, it } from 'vitest';

import { orderShopProducts, shopGameMode, type ShopOrderProduct, type ShopOrderTeam } from './shop-order.js';

const p = (id: string, productType: string, position: number, extra: Partial<ShopOrderProduct> = {}) => ({
  id,
  productType,
  position,
  available: true,
  price: 100,
  source: 'live' as const,
  ...extra,
});

const teams: ShopOrderTeam[] = [
  {
    teamId: 'casa',
    products: [
      p('c-kit', 'home_kit', 0),
      p('c-cap', 'cap', 1),
      p('c-craque', 'home_kit', 2, { personId: 'craque' }),
      p('c-comemorativo', 'commemorative', 3),
      p('c-campeao', 'champion', 4),
    ],
  },
  {
    teamId: 'fora',
    products: [p('f-kit', 'home_kit', 0), p('f-campeao', 'champion', 1), p('f-mug', 'mug', 2)],
  },
];
const ids = (r: ReturnType<typeof orderShopProducts>, team: string) =>
  r.teams.find((t) => t.teamId === team)?.products.map((x) => x.id);

describe('modo pelo status (#923)', () => {
  it('antes, ao vivo e depois; campeão só depois de final com vencedor', () => {
    expect(shopGameMode({ status: 'scheduled' })).toBe('pre');
    expect(shopGameMode({ status: 'starting' })).toBe('pre');
    expect(shopGameMode({ status: 'live' })).toBe('live');
    expect(shopGameMode({ status: 'break' })).toBe('live');
    expect(shopGameMode({ status: 'finished' })).toBe('post');
    expect(shopGameMode({ status: 'finished', competitionContext: ['final'], titleWinnerId: 'casa' })).toBe(
      'champion',
    );
    expect(shopGameMode({ status: 'finished', competitionContext: ['final'], titleWinnerId: null })).toBe(
      'post',
    );
    expect(shopGameMode({ status: 'live', competitionContext: ['final'], titleWinnerId: 'casa' })).toBe(
      'live',
    );
  });

  it('override do widget vale sobre o status', () => {
    expect(shopGameMode({ status: 'live' }, 'pre')).toBe('pre');
    expect(
      shopGameMode({ status: 'finished', competitionContext: ['final'], titleWinnerId: 'x' }, 'post'),
    ).toBe('champion');
    expect(shopGameMode({ status: 'scheduled' }, 'post')).toBe('post');
  });
});

describe('ordem dos produtos (#923)', () => {
  it('sem contexto: a ordem da curadoria, sem produto de campeão', () => {
    const r = orderShopProducts(teams, { status: 'scheduled' });
    expect(r.mode).toBe('pre');
    expect(ids(r, 'casa')).toEqual(['c-kit', 'c-cap', 'c-craque', 'c-comemorativo']);
    expect(ids(r, 'fora')).toEqual(['f-kit', 'f-mug']);
  });

  it('escalação saída: sobe a camisa do destaque', () => {
    const r = orderShopProducts(teams, { status: 'live', featured: { casa: ['craque'] } });
    expect(ids(r, 'casa')?.[0]).toBe('c-craque');
  });

  it('clássico: sobe o comemorativo', () => {
    const r = orderShopProducts(teams, { status: 'scheduled', derby: true });
    expect(ids(r, 'casa')).toEqual(['c-comemorativo', 'c-kit', 'c-cap', 'c-craque']);
  });

  it('depois da final: produto de campeão sobe para o vencedor e nunca aparece para o outro', () => {
    const r = orderShopProducts(teams, {
      status: 'finished',
      competitionContext: ['final'],
      titleWinnerId: 'fora',
      derby: true,
    });
    expect(r.mode).toBe('champion');
    expect(ids(r, 'fora')).toEqual(['f-campeao', 'f-kit', 'f-mug']);
    expect(ids(r, 'casa')).not.toContain('c-campeao');
  });

  it('destaque e clássico juntos: o destaque vem primeiro', () => {
    const r = orderShopProducts(teams, { status: 'live', derby: true, featured: { casa: ['craque'] } });
    expect(ids(r, 'casa')?.slice(0, 2)).toEqual(['c-craque', 'c-comemorativo']);
  });

  it('nunca mostra sem estoque nem sem preço da loja; curado sem preço aparece', () => {
    const r = orderShopProducts(
      [
        {
          teamId: 'casa',
          products: [
            p('sem-estoque', 'home_kit', 0, { available: false }),
            p('sem-preco', 'cap', 1, { price: null }),
            p('curado', 'mug', 2, { price: null, source: 'curated' }),
          ],
        },
      ],
      { status: 'scheduled' },
    );
    expect(ids(r, 'casa')).toEqual(['curado']);
  });

  it('time sem nada some; corta em produtos por time (3 a 6)', () => {
    const r = orderShopProducts(
      [...teams, { teamId: 'vazio', products: [p('x', 'cap', 0, { available: false })] }],
      { status: 'scheduled' },
      { perTeam: 3 },
    );
    expect(r.teams.map((t) => t.teamId)).toEqual(['casa', 'fora']);
    expect(ids(r, 'casa')).toEqual(['c-kit', 'c-cap', 'c-craque']);
    expect(orderShopProducts(teams, { status: 'scheduled' }, { perTeam: 50 }).teams[0]!.products.length).toBe(
      4,
    );
  });

  it('empate de posição: desempata pelo id (estável)', () => {
    const r = orderShopProducts([{ teamId: 't', products: [p('b', 'cap', 0), p('a', 'cap', 0)] }], {
      status: 'scheduled',
    });
    expect(ids(r, 't')).toEqual(['a', 'b']);
  });

  it('clássico também pelo competition_context', () => {
    const r = orderShopProducts(teams, { status: 'scheduled', competitionContext: ['derby'] });
    expect(ids(r, 'casa')?.[0]).toBe('c-comemorativo');
  });

  it('jogo de ida de final: sem campeão decidido, sem produto de campeão', () => {
    const r = orderShopProducts(teams, {
      status: 'finished',
      competitionContext: ['final'],
      titleWinnerId: null,
    });
    expect(r.mode).toBe('post');
    expect(ids(r, 'fora')).not.toContain('f-campeao');
  });

  it('perTeam estranho volta ao teto; abaixo de 3 sobe para 3', () => {
    expect(
      orderShopProducts(teams, { status: 'scheduled' }, { perTeam: Number.NaN }).teams[0]!.products.length,
    ).toBe(4);
    expect(orderShopProducts(teams, { status: 'scheduled' }, { perTeam: 1 }).teams[0]!.products.length).toBe(
      3,
    );
  });

  it('cancelado ou abandonado não vira pós-jogo', () => {
    expect(shopGameMode({ status: 'cancelled' })).toBe('pre');
    expect(shopGameMode({ status: 'abandoned' })).toBe('pre');
  });
});
