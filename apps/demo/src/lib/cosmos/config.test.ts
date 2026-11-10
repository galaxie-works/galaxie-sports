import { describe, expect, it } from 'vitest';

import { canBuyCredits, checkoutUrls, packageMarket, stripeSecretKey } from './config';

const tenant = { id: 't', name: 'T' } as never;

describe('compra de créditos da Cosmos', () => {
  it('compra: admin e cliente com tenant; sem tenant ou papel user, não', () => {
    expect(canBuyCredits({ role: 'admin', tenant })).toBe(true);
    expect(canBuyCredits({ role: 'client', tenant })).toBe(true);
    expect(canBuyCredits({ role: 'client', tenant: null })).toBe(false);
    expect(canBuyCredits({ role: 'user' as never, tenant })).toBe(false);
  });

  it('mercado dos pacotes pelo que o tenant contratou', () => {
    expect(packageMarket(['br', 'ar'])).toBe('BR');
    expect(packageMarket(['US', 'CA'])).toBe('US');
    expect(packageMarket(['CA'])).toBe('CA');
    expect(packageMarket([])).toBe('BR');
    expect(packageMarket(['MX'])).toBe('BR');
  });

  it('sem chave do Stripe, a compra fica indisponível', () => {
    expect(stripeSecretKey({})).toBeNull();
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: '  ' })).toBeNull();
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: 'sk_test_x' })).toBe('sk_test_x');
  });

  it('volta do checkout para a área da Cosmos com a intenção', () => {
    expect(checkoutUrls('i1', { BETTER_AUTH_URL: 'https://demo.exemplo/' })).toEqual({
      success: 'https://demo.exemplo/cliente/cosmos?purchase=i1&status=success',
      cancel: 'https://demo.exemplo/cliente/cosmos?purchase=i1&status=canceled',
    });
  });
});
