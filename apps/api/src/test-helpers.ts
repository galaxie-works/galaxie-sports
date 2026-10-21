import { PLAN_MODULES, type ApiModule, type ApiPlan } from '@galaxie/db';
import { generateApiKey, hashSecret } from './auth/keys.js';
import { InMemoryTenantStore, type TenantRecord } from './auth/tenant-store.js';

/** Cria um tenant em memória com uma chave válida (apenas testes). */
export async function memoryTenant(
  overrides: Partial<TenantRecord> & { plan?: ApiPlan; scopes?: ApiModule[] | null } = {},
  store = new InMemoryTenantStore(),
) {
  const generated = generateApiKey('test');
  const plan = overrides.plan ?? 'core_data';
  store.add(generated.prefix, {
    keyId: `key-${generated.prefix}`,
    secretHash: await hashSecret(generated.secret),
    scopes: overrides.scopes ?? null,
    expiresAt: null,
    revokedAt: null,
    tenant: {
      id: overrides.id ?? `tenant-${generated.prefix}`,
      slug: overrides.slug ?? 'teste',
      plan,
      modules: overrides.modules ?? [...PLAN_MODULES[plan]],
      markets: overrides.markets ?? [],
      sports: overrides.sports ?? [],
      rateLimitPerMinute: overrides.rateLimitPerMinute ?? 100,
      status: overrides.status ?? 'active',
    },
  });
  return { store, key: generated.key, prefix: generated.prefix };
}
