import { and, desc, eq, gte } from 'drizzle-orm';
import type { Database } from './client.js';
import { accessErrorDaily, apiKey, usageDaily, type AccessErrorReason } from './schema/index.js';

export interface TenantAccessError {
  day: string;
  reason: AccessErrorReason;
  keyPrefix: string;
  detail: string;
  count: number;
  lastAt: Date;
}

/** `YYYY-MM-DD` UTC de `days` dias atrás (inclusive hoje = 1 dia). */
const since = (days: number, now: Date) => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - Math.max(days, 1) + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Erros de acesso do tenant nos últimos `days` dias (UTC), mais recentes primeiro. Só o prefixo público da chave
 * e o detalhe (origem, rota ou módulo): nada de segredo. Para o diagnóstico de chaves na Cosmos (#1007).
 */
export async function listTenantAccessErrors(
  db: Database,
  tenantId: string,
  options: { days?: number; limit?: number; now?: Date } = {},
): Promise<TenantAccessError[]> {
  const rows = await db
    .select({
      day: accessErrorDaily.day,
      reason: accessErrorDaily.reason,
      keyPrefix: accessErrorDaily.keyPrefix,
      detail: accessErrorDaily.detail,
      count: accessErrorDaily.count,
      lastAt: accessErrorDaily.lastAt,
    })
    .from(accessErrorDaily)
    .where(
      and(
        eq(accessErrorDaily.tenantId, tenantId),
        gte(accessErrorDaily.day, since(options.days ?? 7, options.now ?? new Date())),
      ),
    )
    .orderBy(desc(accessErrorDaily.lastAt))
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500));
  return rows.map((r) => ({ ...r, reason: r.reason as AccessErrorReason, count: Number(r.count) }));
}

/** Chave secreta do tenant só com o que é público: prefixo, ambiente, nome e situação. Nunca o hash do segredo. */
export interface TenantSecretKeyState {
  prefix: string;
  env: 'live' | 'test';
  label: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Chaves secretas do tenant (inclusive revogadas), para o diagnóstico de chaves da Cosmos (#1007). */
export async function listTenantSecretKeyStates(
  db: Database,
  tenantId: string,
): Promise<TenantSecretKeyState[]> {
  return db
    .select({
      prefix: apiKey.prefix,
      env: apiKey.env,
      label: apiKey.label,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
    })
    .from(apiKey)
    .where(eq(apiKey.tenantId, tenantId))
    .orderBy(desc(apiKey.createdAt));
}

/** Uso consolidado do tenant por dia e rota desde `sinceDay` (`YYYY-MM-DD`, UTC), para o relatório do mês (#1007). */
export async function listTenantUsageByRoute(
  db: Database,
  tenantId: string,
  sinceDay: string,
): Promise<{ day: string; route: string; requests: number }[]> {
  const rows = await db
    .select({ day: usageDaily.day, route: usageDaily.route, requests: usageDaily.requests })
    .from(usageDaily)
    .where(and(eq(usageDaily.tenantId, tenantId), gte(usageDaily.day, sinceDay)));
  return rows.map((r) => ({ ...r, requests: Number(r.requests) }));
}
