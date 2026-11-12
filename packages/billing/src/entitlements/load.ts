import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { catalogVersion, tenant, tenantModuleLimit, tenantOverride, wallet } from '@galaxie/db/schema';
import type { Catalog } from '../catalog/catalog.js';
import type { CapacityTier } from '../catalog/schema.js';
import {
  resolveEntitlements,
  type EntitlementInputs,
  type Entitlements,
  type ResolveOptions,
} from './resolve.js';

/** Lê do banco o que a resolução precisa; null = tenant não existe. */
export async function loadEntitlementInputs(
  db: Database,
  tenantId: string,
  now = new Date(),
): Promise<EntitlementInputs | null> {
  const [t] = await db
    .select({
      id: tenant.id,
      plan: tenant.plan,
      modules: tenant.modules,
      markets: tenant.markets,
      sports: tenant.sports,
      rateLimitPerMinute: tenant.rateLimitPerMinute,
      dailyRequestQuota: tenant.dailyRequestQuota,
      trialEndsAt: tenant.trialEndsAt,
      status: tenant.status,
      catalogVersion: tenant.catalogVersion,
      capacityTier: tenant.capacityTier,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);
  if (!t) return null;
  const [moduleLimits, overrides, wallets] = await Promise.all([
    db
      .select({ key: tenantModuleLimit.key, value: tenantModuleLimit.value })
      .from(tenantModuleLimit)
      .where(eq(tenantModuleLimit.tenantId, tenantId)),
    db
      .select({
        kind: tenantOverride.kind,
        key: tenantOverride.key,
        value: tenantOverride.value,
        validUntil: tenantOverride.validUntil,
        revokedAt: tenantOverride.revokedAt,
      })
      .from(tenantOverride)
      .where(
        and(
          eq(tenantOverride.tenantId, tenantId),
          isNull(tenantOverride.revokedAt),
          gt(tenantOverride.validUntil, now),
        ),
      ),
    db
      .select({ available: wallet.available, status: wallet.status })
      .from(wallet)
      .where(eq(wallet.tenantId, tenantId))
      .limit(1),
  ]);
  return {
    tenant: { ...t, capacityTier: (t.capacityTier ?? null) as CapacityTier | null },
    moduleLimits,
    overrides,
    wallet: wallets[0] ?? null,
  };
}

/** Cache chave-valor (o Valkey da API, pelo ioredis, cabe aqui). */
export interface EntitlementsCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** A versão do catálogo entra na chave: depois de um deploy que muda o catálogo, o cache antigo não é lido. */
export const entitlementsCacheKey = (catalogVersion: string, tenantId: string): string =>
  `billing:entitlements:${catalogVersion}:${tenantId}`;

/** Fallback do cache: mesmo sem invalidação, uma mudança vale em até um minuto (como o cache do autenticador). */
export const ENTITLEMENTS_CACHE_SECONDS = 60;

export type EntitlementsDeps = {
  db: Database;
  catalog: Catalog;
  cache?: EntitlementsCacheStore | null;
  galaxieTenantIds?: readonly string[];
  cacheSeconds?: number;
  now?: () => Date;
};

/**
 * Os direitos do tenant: a função única que API, console, `engage-api`, Cosmos e widgets consultam. Lê o cache e,
 * sem ele, resolve pelo banco e grava. Falha do cache nunca derruba a resposta: cai para o banco.
 */
export async function entitlements(deps: EntitlementsDeps, tenantId: string): Promise<Entitlements | null> {
  const key = entitlementsCacheKey(deps.catalog.version, tenantId);
  if (deps.cache) {
    try {
      const hit = await deps.cache.get(key);
      if (hit) {
        const parsed = JSON.parse(hit) as Entitlements;
        if (parsed && parsed.tenantId === tenantId) return parsed;
      }
    } catch {
      // Valkey fora: segue pelo banco
    }
  }
  const now = deps.now?.() ?? new Date();
  const inputs = await loadEntitlementInputs(deps.db, tenantId, now);
  if (!inputs) return null;
  const opts: ResolveOptions = { now };
  if (deps.galaxieTenantIds) opts.galaxieTenantIds = deps.galaxieTenantIds;
  const resolved = resolveEntitlements(deps.catalog, inputs, opts);
  if (deps.cache) {
    // o cache não pode passar do fim do trial nem da exceção que vence primeiro
    let ttl = deps.cacheSeconds ?? ENTITLEMENTS_CACHE_SECONDS;
    const ends = [inputs.tenant.trialEndsAt, ...inputs.overrides.map((o) => o.validUntil)].filter(
      (d): d is Date => !!d && d.getTime() > now.getTime(),
    );
    for (const d of ends) ttl = Math.min(ttl, Math.max(1, Math.ceil((d.getTime() - now.getTime()) / 1000)));
    try {
      await deps.cache.set(key, JSON.stringify(resolved), 'EX', ttl);
    } catch {
      // sem cache, a próxima leitura vai ao banco
    }
  }
  return resolved;
}

/** Apaga o cache do tenant: chamar depois de qualquer mudança de plano, módulo, faixa, exceção ou estado. */
export async function invalidateEntitlements(
  cache: EntitlementsCacheStore | null | undefined,
  catalog: Pick<Catalog, 'version'>,
  tenantId: string,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.del(entitlementsCacheKey(catalog.version, tenantId));
  } catch {
    // o TTL curto cobre a falha
  }
}

/** Registra a versão do catálogo carregada (idempotente). Chamado na subida da API. */
export async function recordCatalogVersion(db: Database, version: string): Promise<void> {
  await db.insert(catalogVersion).values({ version }).onConflictDoNothing();
}
