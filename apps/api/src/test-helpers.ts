import { PLAN_MODULES, type ApiModule, type ApiPlan } from '@galaxie/db';
import { formatApiKey, generateApiKey, hashSecret, parseApiKey, type KeyEnv } from './auth/keys.js';
import { InMemoryTenantStore, type TenantRecord } from './auth/tenant-store.js';

/** Cria um tenant em memória com uma chave válida (apenas testes). */
export async function memoryTenant(
  overrides: Partial<TenantRecord> & { plan?: ApiPlan; scopes?: ApiModule[] | null; env?: KeyEnv } = {},
  store = new InMemoryTenantStore(),
) {
  const generated = generateApiKey(overrides.env ?? 'live');
  const plan = overrides.plan ?? 'core_data';
  store.add(generated.prefix, {
    keyId: `key-${generated.prefix}`,
    secretHash: await hashSecret(generated.secret),
    env: generated.env,
    keyFormat: generated.format,
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
      dailyRequestQuota: overrides.dailyRequestQuota ?? null,
      trialEndsAt: overrides.trialEndsAt ?? null,
    },
  });
  return { store, key: generated.key, prefix: generated.prefix };
}

/** A mesma chave (ambiente e prefixo) com outro segredo e checksum válido: "segredo errado" nos testes. */
export function withRandomSecret(key: string): string {
  const p = parseApiKey(key)!;
  return formatApiKey(p.env, p.prefix, generateApiKey().secret);
}
