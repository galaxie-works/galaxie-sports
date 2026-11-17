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
import { createApiKey, type CreatedKey } from '@galaxie/db/api-keys';
import { recordTenantCreated, transitionTenantState } from '@galaxie/billing';

export { createApiKey, type CreatedKey };

/** Banco ou transação (as funções abaixo podem rodar dentro de `db.transaction`). */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TenantInput {
  slug: string;
  name: string;
  plan: ApiPlan;
  /** Padrão: módulos do plano. */
  modules?: ApiModule[];
  markets?: string[];
  sports?: string[];
  rateLimitPerMinute?: number;
  dailyRequestQuota?: number | null;
  /** Fim do trial (plano `trial`); null = sem prazo. */
  trialEndsAt?: Date | null;
}

export function isModule(value: string): value is ApiModule {
  return (API_MODULES as readonly string[]).includes(value);
}

/**
 * Cria o tenant ou atualiza o existente com o mesmo slug (idempotente). Na criação, a máquina de estados (F3) nasce em
 * `draft` e vai a `trial` (com prazo) ou `active` (contrato), causa `provision`; na atualização o estado não muda.
 */
export async function upsertTenant(
  db: DbOrTx,
  input: TenantInput,
  actor = 'cli:tenant-create',
): Promise<{ id: string; created: boolean }> {
  const values = {
    slug: input.slug,
    name: input.name,
    plan: input.plan,
    modules: input.modules ?? [...PLAN_MODULES[input.plan]],
    markets: (input.markets ?? []).map((m) => m.toUpperCase()),
    sports: input.sports ?? [],
    rateLimitPerMinute: input.rateLimitPerMinute ?? 120,
    ...(input.dailyRequestQuota !== undefined ? { dailyRequestQuota: input.dailyRequestQuota } : {}),
    ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt } : {}),
  };
  const [row] = await db
    .insert(tenant)
    .values({ ...values, state: 'draft' })
    .onConflictDoUpdate({ target: tenant.slug, set: { ...values, updatedAt: sql`now()` } })
    .returning({ id: tenant.id, created: sql<boolean>`(xmax = 0)` });
  const t = row!;
  if (t.created) {
    const now = new Date();
    await recordTenantCreated(db, t.id, { cause: 'provision', actor, now });
    await transitionTenantState(db, t.id, input.trialEndsAt ? 'trial' : 'active', {
      cause: 'provision',
      actor,
      reason: 'criação pela CLI tenant:create (upsertTenant)',
      now,
    });
  }
  return t;
}

export async function revokeApiKey(db: Database, keyId: string, at = new Date()): Promise<void> {
  await db.update(apiKey).set({ revokedAt: at }).where(eq(apiKey.id, keyId));
}
