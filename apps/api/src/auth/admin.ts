import { eq, sql } from 'drizzle-orm';
import {
  API_MODULES,
  apiKey,
  PLAN_MODULES,
  tenant,
  type ApiModule,
  type ApiPlan,
  type Database,
} from '@galaxie/db';
import { generateApiKey, hashSecret, type KeyEnv } from './keys.js';

export interface TenantInput {
  slug: string;
  name: string;
  plan: ApiPlan;
  /** Padrão: módulos do plano. */
  modules?: ApiModule[];
  markets?: string[];
  sports?: string[];
  rateLimitPerMinute?: number;
}

export function isModule(value: string): value is ApiModule {
  return (API_MODULES as readonly string[]).includes(value);
}

/** Cria o tenant ou atualiza o existente com o mesmo slug (idempotente). */
export async function upsertTenant(
  db: Database,
  input: TenantInput,
): Promise<{ id: string; created: boolean }> {
  const values = {
    slug: input.slug,
    name: input.name,
    plan: input.plan,
    modules: input.modules ?? [...PLAN_MODULES[input.plan]],
    markets: (input.markets ?? []).map((m) => m.toUpperCase()),
    sports: input.sports ?? [],
    rateLimitPerMinute: input.rateLimitPerMinute ?? 120,
  };
  const [row] = await db
    .insert(tenant)
    .values(values)
    .onConflictDoUpdate({ target: tenant.slug, set: { ...values, updatedAt: sql`now()` } })
    .returning({ id: tenant.id, created: sql<boolean>`(xmax = 0)` });
  return row!;
}

export interface CreatedKey {
  id: string;
  prefix: string;
  /** Chave completa — exibida uma única vez. */
  key: string;
}

export async function createApiKey(
  db: Database,
  tenantId: string,
  options: { label?: string; scopes?: ApiModule[]; env?: KeyEnv; expiresAt?: Date } = {},
): Promise<CreatedKey> {
  const generated = generateApiKey(options.env ?? 'live');
  const [row] = await db
    .insert(apiKey)
    .values({
      tenantId,
      prefix: generated.prefix,
      secretHash: await hashSecret(generated.secret),
      label: options.label ?? null,
      scopes: options.scopes ?? null,
      expiresAt: options.expiresAt ?? null,
    })
    .returning({ id: apiKey.id });
  return { id: row!.id, prefix: generated.prefix, key: generated.key };
}

export async function revokeApiKey(db: Database, keyId: string, at = new Date()): Promise<void> {
  await db.update(apiKey).set({ revokedAt: at }).where(eq(apiKey.id, keyId));
}
