import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { apiKey, tenant, type ApiModule, type ApiPlan, type Database } from '@galaxie/db';
import { createApiKey, type CreatedKey } from '../auth/admin.js';
import type { KeyEnv } from '../auth/keys.js';
import type { PlanCatalog } from './plans.js';

/** Visão administrativa de um tenant (sem segredos). */
export type TenantView = typeof tenant.$inferSelect;

/** Metadados de uma chave (nunca o hash nem o segredo). */
export interface KeyView {
  id: string;
  prefix: string;
  env: KeyEnv;
  label: string | null;
  scopes: ApiModule[] | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  /** active | expiring (expira no futuro) | expired | revoked */
  status: 'active' | 'expiring' | 'expired' | 'revoked';
}

export interface NewKeyOptions {
  label?: string | undefined;
  scopes?: ApiModule[] | undefined;
  env?: KeyEnv | undefined;
  expiresAt?: Date | undefined;
}

export interface OnboardingInput {
  slug: string;
  name: string;
  plan: ApiPlan;
  /** Ajustes sobre o modelo do plano (ausente = valor do modelo). */
  modules?: ApiModule[] | undefined;
  markets?: string[] | undefined;
  sports?: string[] | undefined;
  rateLimitPerMinute?: number | undefined;
  dailyRequestQuota?: number | null | undefined;
  /** Chave inicial (padrão: uma chave no ambiente do modelo, sem restrição de escopo). */
  key?: NewKeyOptions | false | undefined;
}

export class TenantConflictError extends Error {
  constructor(readonly slug: string) {
    super(`Já existe um tenant com o slug ${slug}.`);
    this.name = 'TenantConflictError';
  }
}

const keyStatus = (k: typeof apiKey.$inferSelect, now: Date): KeyView['status'] => {
  if (k.revokedAt && k.revokedAt <= now) return 'revoked';
  if (k.expiresAt && k.expiresAt <= now) return 'expired';
  if (k.expiresAt) return 'expiring';
  return 'active';
};

export function toKeyView(k: typeof apiKey.$inferSelect, now = new Date()): KeyView {
  return {
    id: k.id,
    prefix: k.prefix,
    env: k.env,
    label: k.label,
    scopes: k.scopes,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    lastUsedAt: k.lastUsedAt,
    status: keyStatus(k, now),
  };
}

/** Escopos de chave precisam estar contidos nos módulos do tenant. */
export function invalidScopes(
  modules: readonly ApiModule[],
  scopes: readonly ApiModule[] | undefined,
): ApiModule[] {
  return (scopes ?? []).filter((s) => !modules.includes(s));
}

/** Valores efetivos do tenant: modelo do plano + ajustes. */
export function resolveTenantValues(
  plans: PlanCatalog,
  input: Omit<OnboardingInput, 'key' | 'slug' | 'name'>,
) {
  const t = plans[input.plan];
  return {
    plan: input.plan,
    modules: [...new Set(input.modules ?? t.modules)] as ApiModule[],
    markets: (input.markets ?? t.markets).map((m) => m.toUpperCase()),
    sports: input.sports ?? t.sports,
    rateLimitPerMinute: input.rateLimitPerMinute ?? t.rateLimitPerMinute,
    dailyRequestQuota: input.dailyRequestQuota !== undefined ? input.dailyRequestQuota : t.dailyRequestQuota,
  };
}

/**
 * Onboarding: cria o tenant a partir do modelo do plano e (por padrão) a primeira chave, numa
 * transação. Slug repetido → TenantConflictError (não sobrescreve um cliente existente).
 */
export async function createTenantFromPlan(
  db: Database,
  plans: PlanCatalog,
  input: OnboardingInput,
): Promise<{ tenant: TenantView; key: CreatedKey | null }> {
  const values = resolveTenantValues(plans, input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tenant)
      .values({ slug: input.slug, name: input.name, ...values })
      .onConflictDoNothing({ target: tenant.slug })
      .returning();
    if (!row) throw new TenantConflictError(input.slug);
    let key: CreatedKey | null = null;
    if (input.key !== false) {
      const k = input.key ?? {};
      key = await createApiKey(tx, row.id, {
        env: k.env ?? plans[input.plan].defaultKeyEnv,
        label: k.label ?? 'principal',
        ...(k.scopes ? { scopes: k.scopes } : {}),
        ...(k.expiresAt ? { expiresAt: k.expiresAt } : {}),
      });
    }
    return { tenant: row, key };
  });
}

export async function getTenant(db: Database, idOrSlug: string): Promise<TenantView | undefined> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const [row] = await db
    .select()
    .from(tenant)
    .where(isUuid ? eq(tenant.id, idOrSlug) : eq(tenant.slug, idOrSlug))
    .limit(1);
  return row;
}

export async function listTenants(
  db: Database,
  filter: { status?: 'active' | 'suspended'; plan?: ApiPlan; limit: number; offset: number },
): Promise<TenantView[]> {
  const where = [];
  if (filter.status) where.push(eq(tenant.status, filter.status));
  if (filter.plan) where.push(eq(tenant.plan, filter.plan));
  return db
    .select()
    .from(tenant)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(tenant.slug))
    .limit(filter.limit)
    .offset(filter.offset);
}

export interface TenantPatch {
  name?: string | undefined;
  plan?: ApiPlan | undefined;
  /** Reaplica módulos/mercados/esportes/limites do modelo do plano (antes dos demais ajustes). */
  applyTemplate?: boolean | undefined;
  modules?: ApiModule[] | undefined;
  markets?: string[] | undefined;
  sports?: string[] | undefined;
  rateLimitPerMinute?: number | undefined;
  dailyRequestQuota?: number | null | undefined;
  status?: 'active' | 'suspended' | undefined;
}

export async function updateTenant(
  db: Database,
  plans: PlanCatalog,
  id: string,
  patch: TenantPatch,
): Promise<TenantView | undefined> {
  const current = await getTenant(db, id);
  if (!current) return undefined;
  const plan = patch.plan ?? current.plan;
  const base = patch.applyTemplate ? resolveTenantValues(plans, { plan }) : {};
  const set = {
    ...base,
    plan,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.modules !== undefined ? { modules: [...new Set(patch.modules)] } : {}),
    ...(patch.markets !== undefined ? { markets: patch.markets.map((m) => m.toUpperCase()) } : {}),
    ...(patch.sports !== undefined ? { sports: patch.sports } : {}),
    ...(patch.rateLimitPerMinute !== undefined ? { rateLimitPerMinute: patch.rateLimitPerMinute } : {}),
    ...(patch.dailyRequestQuota !== undefined ? { dailyRequestQuota: patch.dailyRequestQuota } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: sql`now()`,
  };
  const [row] = await db.update(tenant).set(set).where(eq(tenant.id, current.id)).returning();
  return row;
}

export async function listKeys(db: Database, tenantId: string, now = new Date()): Promise<KeyView[]> {
  const rows = await db
    .select()
    .from(apiKey)
    .where(eq(apiKey.tenantId, tenantId))
    .orderBy(desc(apiKey.createdAt));
  return rows.map((r) => toKeyView(r, now));
}

export async function issueKey(
  db: Database,
  tenantId: string,
  options: NewKeyOptions = {},
): Promise<CreatedKey> {
  return createApiKey(db, tenantId, options);
}

/** Revoga uma chave do tenant; false se a chave não existe, não é do tenant ou já estava revogada. */
export async function revokeTenantKey(
  db: Database,
  tenantId: string,
  keyId: string,
  at = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(apiKey)
    .set({ revokedAt: at })
    .where(and(eq(apiKey.id, keyId), eq(apiKey.tenantId, tenantId), isNull(apiKey.revokedAt)))
    .returning({ id: apiKey.id });
  return rows.length > 0;
}

/** Período máximo em que a chave antiga continua válida após a rotação. */
export const MAX_ROTATION_GRACE_SEC = 7 * 86_400;

/**
 * Rotação: cria uma chave nova com o mesmo rótulo, escopos e ambiente e encurta a validade da
 * antiga para `graceSeconds` (0 = revoga já). Assim o cliente troca a chave sem janela de erro.
 * Devolve undefined se a chave não existe, não é do tenant ou já foi revogada/expirou.
 */
export async function rotateKey(
  db: Database,
  tenantId: string,
  keyId: string,
  options: { graceSeconds: number; now?: Date },
): Promise<{ key: CreatedKey; previous: KeyView } | undefined> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(apiKey)
      .where(and(eq(apiKey.id, keyId), eq(apiKey.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!old) return undefined;
    const status = keyStatus(old, now);
    if (status === 'revoked' || status === 'expired') return undefined;

    const key = await createApiKey(tx, tenantId, {
      env: old.env,
      ...(old.label ? { label: old.label } : {}),
      ...(old.scopes ? { scopes: old.scopes } : {}),
    });
    const graceEnd = new Date(now.getTime() + Math.min(options.graceSeconds, MAX_ROTATION_GRACE_SEC) * 1000);
    const [prev] = await tx
      .update(apiKey)
      .set(
        options.graceSeconds <= 0
          ? { revokedAt: now }
          : { expiresAt: old.expiresAt && old.expiresAt < graceEnd ? old.expiresAt : graceEnd },
      )
      .where(eq(apiKey.id, old.id))
      .returning();
    return { key, previous: toKeyView(prev!, now) };
  });
}
