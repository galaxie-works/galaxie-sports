import { and, desc, eq, gt, gte, max, or, sql, sum } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  accessErrorDaily,
  apiKey,
  usageDaily,
  webhookDelivery,
  webhookEndpoint,
  type AccessErrorReason,
  type WebhookDeliveryStatus,
} from './schema/index.js';

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

/** Erros de acesso somados por chave, motivo e detalhe no período, os mais frequentes primeiro. */
export interface TenantAccessErrorSum {
  reason: AccessErrorReason;
  keyPrefix: string;
  detail: string;
  count: number;
  /** Último dia (UTC) com o erro. */
  lastDay: string;
}

/**
 * Soma no banco os erros dos últimos `days` dias (UTC) por chave, motivo e detalhe, ordenados pela soma: o
 * diagnóstico e o relatório veem os totais certos mesmo com muitas linhas por dia (#1007).
 */
export async function sumTenantAccessErrors(
  db: Database,
  tenantId: string,
  options: { days?: number; limit?: number; now?: Date } = {},
): Promise<TenantAccessErrorSum[]> {
  const total = sum(accessErrorDaily.count).mapWith(Number);
  const rows = await db
    .select({
      reason: accessErrorDaily.reason,
      keyPrefix: accessErrorDaily.keyPrefix,
      detail: accessErrorDaily.detail,
      count: total,
      lastDay: max(accessErrorDaily.day),
    })
    .from(accessErrorDaily)
    .where(
      and(
        eq(accessErrorDaily.tenantId, tenantId),
        gte(accessErrorDaily.day, since(options.days ?? 7, options.now ?? new Date())),
      ),
    )
    .groupBy(accessErrorDaily.reason, accessErrorDaily.keyPrefix, accessErrorDaily.detail)
    .orderBy(desc(total), desc(max(accessErrorDaily.day)))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 1000));
  return rows.map((r) => ({ ...r, reason: r.reason as AccessErrorReason, lastDay: r.lastDay ?? '' }));
}

/** Entrega com falha de um endpoint do tenant (só o que o diagnóstico de webhooks lê). */
export interface TenantWebhookFailure {
  topic: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  responseExcerpt: string | null;
  at: Date;
}

/**
 * Entregas com falha do endpoint (mortas, ou pendentes depois de uma tentativa), mais recentes primeiro; vazio se o
 * endpoint não é do tenant. O filtro fica no banco: falhas antigas não somem atrás de entregas boas (#1007).
 */
export async function listTenantWebhookFailures(
  db: Database,
  tenantId: string,
  endpointId: string,
  limit = 15,
): Promise<TenantWebhookFailure[]> {
  const rows = await db
    .select({
      topic: webhookDelivery.topic,
      status: webhookDelivery.status,
      attempts: webhookDelivery.attempts,
      responseCode: webhookDelivery.responseCode,
      lastError: webhookDelivery.lastError,
      durationMs: webhookDelivery.durationMs,
      responseExcerpt: webhookDelivery.responseExcerpt,
      at: sql<Date>`coalesce(${webhookDelivery.lastAttemptAt}, ${webhookDelivery.createdAt})`.mapWith(
        (v: string | Date) => new Date(v),
      ),
    })
    .from(webhookDelivery)
    .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
    .where(
      and(
        eq(webhookDelivery.endpointId, endpointId),
        eq(webhookEndpoint.tenantId, tenantId),
        or(
          eq(webhookDelivery.status, 'dead'),
          and(eq(webhookDelivery.status, 'pending'), gt(webhookDelivery.attempts, 0)),
        ),
      ),
    )
    .orderBy(desc(webhookDelivery.id))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows;
}
