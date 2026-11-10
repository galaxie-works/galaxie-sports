'use server';

/**
 * Ações dos webhooks no painel do cliente. O tenant sai sempre da sessão (`readClientContext`), nunca do
 * navegador: cada função de `@galaxie/db/webhooks` filtra pelo tenant, então um id de outro tenant não acha nada.
 */
import {
  createTenantWebhook,
  deleteTenantWebhook,
  listTenantWebhookDeliveries,
  MAX_WEBHOOKS_PER_TENANT,
  replayTenantWebhookDead,
  rotateTenantWebhookSecret,
  sendTenantWebhookTest,
  setTenantWebhookActive,
  WebhookPortalError,
} from '@galaxie/db/webhooks';
import { revalidatePath } from 'next/cache';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { parseWebhookForm, webhookSecrets, type WebhookFormInput } from '@/lib/client/webhooks';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface WebhookActionResult {
  ok: boolean;
  error?: string;
  /** Segredo novo (cadastro ou rotação): aparece só nesta resposta. */
  secret?: string;
  /** Entregas recolocadas na fila (reenvio da DLQ). */
  count?: number;
}

export interface DeliveryRow {
  id: number;
  topic: string;
  status: 'pending' | 'delivered' | 'dead';
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  nextRetryAt: string;
}

const PATH = '/cliente/webhooks';

async function texts() {
  return getDictionary(await getRequestLocale()).webhooks;
}

async function tenantOrError() {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx) return { t, error: t.errors.forbidden } as const;
  if (!ctx.tenant) return { t, error: t.errors.noTenant } as const;
  // configuração do tenant: cargo com settings.manage (#1019)
  if (!can(ctx, 'settings.manage'))
    return { t, error: getDictionary(await getRequestLocale()).client.errors.role } as const;
  return { t, tenant: ctx.tenant } as const;
}

function portalError(err: unknown, t: Awaited<ReturnType<typeof texts>>): string {
  if (err instanceof WebhookPortalError) {
    if (err.code === 'limit') return fill(t.limit, { max: MAX_WEBHOOKS_PER_TENANT });
    if (err.code === 'plan') return t.plan;
    if (err.code === 'no_kek') return t.unavailable;
    return t.errors.notFound;
  }
  console.error('[webhooks] ação do painel falhou', err);
  return t.errors.generic;
}

export async function createWebhook(input: WebhookFormInput): Promise<WebhookActionResult> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  const { t } = r;
  const parsed = parseWebhookForm(input);
  if ('kind' in parsed) {
    if (parsed.kind === 'ids') return { ok: false, error: fill(t.errors.ids, { field: t[parsed.field] }) };
    return { ok: false, error: t.errors[parsed.kind] };
  }
  const secrets = webhookSecrets();
  if (!secrets) return { ok: false, error: t.unavailable };
  try {
    const { secret } = await createTenantWebhook(builderDb(), r.tenant.id, parsed, secrets);
    revalidatePath(PATH);
    return { ok: true, secret };
  } catch (err) {
    return { ok: false, error: portalError(err, t) };
  }
}

export async function rotateWebhookSecret(id: string): Promise<WebhookActionResult> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id)) return { ok: false, error: r.t.errors.notFound };
  const secrets = webhookSecrets();
  if (!secrets) return { ok: false, error: r.t.unavailable };
  try {
    const secret = await rotateTenantWebhookSecret(builderDb(), r.tenant.id, id, secrets);
    if (!secret) return { ok: false, error: r.t.errors.notFound };
    return { ok: true, secret };
  } catch (err) {
    return { ok: false, error: portalError(err, r.t) };
  }
}

export async function setWebhookActive(id: string, active: boolean): Promise<WebhookActionResult> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id)) return { ok: false, error: r.t.errors.notFound };
  const ok = await setTenantWebhookActive(builderDb(), r.tenant.id, id, active === true);
  if (!ok) return { ok: false, error: r.t.errors.notFound };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteWebhook(id: string): Promise<WebhookActionResult> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id)) return { ok: false, error: r.t.errors.notFound };
  const ok = await deleteTenantWebhook(builderDb(), r.tenant.id, id);
  if (!ok) return { ok: false, error: r.t.errors.notFound };
  revalidatePath(PATH);
  return { ok: true };
}

export async function sendWebhookTest(id: string): Promise<WebhookActionResult> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id)) return { ok: false, error: r.t.errors.notFound };
  const queued = await sendTenantWebhookTest(builderDb(), r.tenant.id, id);
  // null: não é do tenant ou está desativado (o painel só oferece o teste com o webhook ativo)
  if (queued == null) return { ok: false, error: r.t.errors.inactive };
  revalidatePath(PATH);
  return { ok: true };
}

export async function replayWebhookDead(id: string): Promise<WebhookActionResult> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id)) return { ok: false, error: r.t.errors.notFound };
  const count = await replayTenantWebhookDead(builderDb(), r.tenant.id, id);
  revalidatePath(PATH);
  return { ok: true, count };
}

/** Últimas entregas do webhook, para o diálogo do histórico. */
export async function listWebhookDeliveries(
  id: string,
): Promise<{ ok: boolean; error?: string; rows?: DeliveryRow[] }> {
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id)) return { ok: false, error: r.t.errors.notFound };
  const rows = await listTenantWebhookDeliveries(builderDb(), r.tenant.id, id, 20);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    ok: true,
    rows: rows.map((d) => ({
      id: d.id,
      topic: d.topic,
      status: d.status,
      attempts: d.attempts,
      responseCode: d.responseCode,
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
      lastAttemptAt: iso(d.lastAttemptAt),
      deliveredAt: iso(d.deliveredAt),
      nextRetryAt: d.nextRetryAt.toISOString(),
    })),
  };
}
