import { describe, expect, it } from 'vitest';

import { TENANT_ROLES, type TenantRole } from '@galaxie/engage';

import { checkoutUrls, cosmosAccessError, packageMarket, stripeSecretKey } from './config';

const tenant = { id: 't' };
const member = (role: TenantRole) => ({
  tenant,
  actor: { kind: 'member' as const, tenantId: 't', role, scope: null },
});

describe('compra de créditos da Cosmos', () => {
  it('ver: Dono e Admin; o resto recebe a recusa de cargo', () => {
    expect(TENANT_ROLES.map((r) => cosmosAccessError(member(r), 'cosmos.view'))).toEqual([
      null,
      null,
      'role',
      'role',
      'role',
    ]);
  });

  it('comprar, recarga automática, ligar e desligar: só o Dono (Voluntário e Admin recusados)', () => {
    expect(TENANT_ROLES.map((r) => cosmosAccessError(member(r), 'cosmos.manage'))).toEqual([
      null,
      'role',
      'role',
      'role',
      'role',
    ]);
  });

  it('equipe Galaxie passa; sem sessão ou sem tenant, recusa antes do cargo', () => {
    expect(cosmosAccessError({ tenant, actor: { kind: 'galaxie_staff' } }, 'cosmos.manage')).toBeNull();
    expect(cosmosAccessError(null, 'cosmos.view')).toBe('forbidden');
    expect(cosmosAccessError({ tenant: null, actor: null }, 'cosmos.view')).toBe('noTenant');
    // cargo de outro tenant (sessão trocada) não vale
    expect(
      cosmosAccessError(
        { tenant, actor: { kind: 'member', tenantId: 'outro', role: 'owner', scope: null } },
        'cosmos.manage',
      ),
    ).toBe('role');
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
