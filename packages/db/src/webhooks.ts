/**
 * Webhooks no portal do cliente (`/cliente/webhooks` da demo): cadastro, rotação do segredo, entregas, teste e
 * reenvio da DLQ. Toda função recebe o tenant da sessão e só toca nos endpoints dele, mesmo com um id conhecido.
 *
 * O worker (`apps/api/src/webhooks/worker.ts`) é quem entrega: o teste e o reenvio só põem entregas na fila, e a
 * checagem de destino (SSRF), a assinatura e as retentativas são as mesmas de uma mudança real.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  PLANS_WITHOUT_REALTIME,
  tenant,
  webhookDelivery,
  webhookEndpoint,
  type ApiModule,
  type RealtimeTopic,
  type WebhookDeliveryStatus,
  type WebhookFilters,
} from './schema/index.js';
import { generateWebhookSecret, type WebhookSecretBox } from './webhook-secret-box.js';

export { WEBHOOK_KEK_ENV, WebhookSecretBox, WebhookSecretError } from './webhook-secret-box.js';
export {
  PLANS_WITHOUT_REALTIME,
  REALTIME_TOPICS,
  type RealtimeTopic,
  type WebhookFilters,
} from './schema/index.js';

/** Módulo do plano que cada tópico exige (o mesmo `TOPIC_MODULE` da API, conferido no teste dela). */
export const WEBHOOK_TOPIC_MODULE: Record<RealtimeTopic, ApiModule> = {
  'event.status_changed': 'core_data',
  'event.score_changed': 'core_data',
  'event.incident_added': 'core_data',
  'where_to_watch.changed': 'where_to_watch',
  'event.context_published': 'live_intelligence',
  'event.related_content_changed': 'related_content',
};

/** Endpoints por tenant (ativos ou não). Acima disso, fale com a Galaxie. */
export const MAX_WEBHOOKS_PER_TENANT = 5;

/** Tópico e evento das entregas de teste (`x-galaxie-event: webhook.test`); nunca sai de uma mudança real. */
export const WEBHOOK_TEST_TOPIC = 'webhook.test';

export class WebhookPortalError extends Error {
  constructor(
    readonly code: 'limit' | 'plan' | 'not_found' | 'no_kek',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookPortalError';
  }
}

export interface TenantWebhook {
  id: string;
  url: string;
  description: string | null;
  topics: RealtimeTopic[];
  filters: WebhookFilters;
  active: boolean;
  createdAt: Date;
  pending: number;
  dead: number;
  delivered24h: number;
  lastDeliveredAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
}

export async function listTenantWebhooks(db: Database, tenantId: string): Promise<TenantWebhook[]> {
  const rows = await db.execute<{
    id: string;
    url: string;
    description: string | null;
    topics: RealtimeTopic[];
    filters: WebhookFilters;
    active: boolean;
    created_at: string | Date;
    pending: number;
    dead: number;
    delivered_24h: number;
    last_delivered_at: string | Date | null;
    last_failure_at: string | Date | null;
    last_error: string | null;
  }>(sql`
    select e.id::text, e.url, e.description, e.topics, e.filters, e.active, e.created_at,
           (select count(*)::int from api.webhook_delivery d where d.endpoint_id = e.id and d.status = 'pending')
             as pending,
           (select count(*)::int from api.webhook_delivery d where d.endpoint_id = e.id and d.status = 'dead') as dead,
           (select count(*)::int from api.webhook_delivery d
             where d.endpoint_id = e.id and d.status = 'delivered' and d.delivered_at > now() - interval '24 hours')
             as delivered_24h,
           (select max(d.delivered_at) from api.webhook_delivery d
             where d.endpoint_id = e.id and d.status = 'delivered') as last_delivered_at,
           f.last_attempt_at as last_failure_at, f.last_error
      from api.webhook_endpoint e
      left join lateral (select d.last_attempt_at, d.last_error from api.webhook_delivery d
                          where d.endpoint_id = e.id and d.status <> 'delivered' and d.last_error is not null
                          order by d.last_attempt_at desc nulls last limit 1) f on true
     where e.tenant_id = ${tenantId}
     order by e.created_at, e.id
  `);
  const date = (v: string | Date | null) => (v == null ? null : new Date(v));
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    description: r.description,
    topics: r.topics ?? [],
    filters: r.filters ?? {},
    active: r.active,
    createdAt: new Date(r.created_at),
    pending: Number(r.pending),
    dead: Number(r.dead),
    delivered24h: Number(r.delivered_24h),
    lastDeliveredAt: date(r.last_delivered_at),
    lastFailureAt: date(r.last_failure_at),
    lastError: r.last_error,
  }));
}

export interface TenantWebhookDelivery {
  id: number;
  topic: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  nextRetryAt: Date;
}

/** Últimas entregas do endpoint (mais recentes primeiro); vazio se o endpoint não é do tenant. */
export async function listTenantWebhookDeliveries(
  db: Database,
  tenantId: string,
  endpointId: string,
  limit = 20,
): Promise<TenantWebhookDelivery[]> {
  return db
    .select({
      id: webhookDelivery.id,
      topic: webhookDelivery.topic,
      status: webhookDelivery.status,
      attempts: webhookDelivery.attempts,
      responseCode: webhookDelivery.responseCode,
      lastError: webhookDelivery.lastError,
      createdAt: webhookDelivery.createdAt,
      lastAttemptAt: webhookDelivery.lastAttemptAt,
      deliveredAt: webhookDelivery.deliveredAt,
      nextRetryAt: webhookDelivery.nextRetryAt,
    })
    .from(webhookDelivery)
    .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
    .where(and(eq(webhookDelivery.endpointId, endpointId), eq(webhookEndpoint.tenantId, tenantId)))
    .orderBy(desc(webhookDelivery.id))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export interface TenantWebhookInput {
  /** Já validada pelo chamador (https, sem credenciais, sem IP privado). */
  url: string;
  /** Vazio = todos os tópicos do plano. */
  topics: RealtimeTopic[];
  filters: WebhookFilters;
  description: string | null;
}

/**
 * Cadastra um endpoint do tenant e devolve o segredo (a única vez em que ele aparece). O segredo vai cifrado com a
 * KEK: sem ela, recusa. Trial não tem webhooks, e há um teto de endpoints por tenant.
 */
export async function createTenantWebhook(
  db: Database,
  tenantId: string,
  input: TenantWebhookInput,
  secrets: WebhookSecretBox,
): Promise<{ id: string; secret: string }> {
  if (!secrets.configured) throw new WebhookPortalError('no_kek', 'WEBHOOK_SIGNING_SECRET não definida.');
  return db.transaction(async (tx) => {
    // trava o tenant: dois cadastros simultâneos não passam juntos do teto
    const [t] = await tx
      .select({ plan: tenant.plan })
      .from(tenant)
      .where(eq(tenant.id, tenantId))
      .for('update');
    if (!t) throw new WebhookPortalError('not_found', 'Tenant não encontrado.');
    if (PLANS_WITHOUT_REALTIME.includes(t.plan))
      throw new WebhookPortalError('plan', `O plano ${t.plan} não inclui webhooks.`);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookEndpoint)
      .where(eq(webhookEndpoint.tenantId, tenantId));
    if (Number(count?.n ?? 0) >= MAX_WEBHOOKS_PER_TENANT)
      throw new WebhookPortalError('limit', `Limite de ${MAX_WEBHOOKS_PER_TENANT} webhooks por tenant.`);
    const secret = generateWebhookSecret();
    // id antes do insert: ele entra como dado autenticado (AAD) na cifra do segredo
    const [gen] = await tx.execute<{ id: string }>(sql`select public.uuid_generate_v7()::text as id`);
    const id = gen!.id;
    await tx.insert(webhookEndpoint).values({
      id,
      tenantId,
      url: input.url,
      secret: secrets.seal(secret, id),
      topics: input.topics,
      filters: input.filters,
      description: input.description,
    });
    return { id, secret };
  });
}

/** Troca o segredo do endpoint (o antigo deixa de valer na hora). `null` se o endpoint não é do tenant. */
export async function rotateTenantWebhookSecret(
  db: Database,
  tenantId: string,
  endpointId: string,
  secrets: WebhookSecretBox,
): Promise<string | null> {
  if (!secrets.configured) throw new WebhookPortalError('no_kek', 'WEBHOOK_SIGNING_SECRET não definida.');
  const secret = generateWebhookSecret();
  const rows = await db
    .update(webhookEndpoint)
    .set({ secret: secrets.seal(secret, endpointId), updatedAt: new Date() })
    .where(and(eq(webhookEndpoint.id, endpointId), eq(webhookEndpoint.tenantId, tenantId)))
    .returning({ id: webhookEndpoint.id });
  return rows.length ? secret : null;
}

export async function setTenantWebhookActive(
  db: Database,
  tenantId: string,
  endpointId: string,
  active: boolean,
): Promise<boolean> {
  const rows = await db
    .update(webhookEndpoint)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(webhookEndpoint.id, endpointId), eq(webhookEndpoint.tenantId, tenantId)))
    .returning({ id: webhookEndpoint.id });
  return rows.length > 0;
}

/** Apaga o endpoint e o histórico de entregas dele (cascade). */
export async function deleteTenantWebhook(
  db: Database,
  tenantId: string,
  endpointId: string,
): Promise<boolean> {
  const rows = await db
    .delete(webhookEndpoint)
    .where(and(eq(webhookEndpoint.id, endpointId), eq(webhookEndpoint.tenantId, tenantId)))
    .returning({ id: webhookEndpoint.id });
  return rows.length > 0;
}

/**
 * Põe na fila uma entrega de teste (`webhook.test`), assinada e entregue pelo worker como qualquer outra. O
 * `change_id` é negativo: nunca colide com uma mudança real (ids do change feed são positivos). `null` se o
 * endpoint não é do tenant ou está desativado.
 */
export async function sendTenantWebhookTest(
  db: Database,
  tenantId: string,
  endpointId: string,
  now: Date = new Date(),
): Promise<number | null> {
  const [ep] = await db
    .select({ id: webhookEndpoint.id })
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.id, endpointId),
        eq(webhookEndpoint.tenantId, tenantId),
        eq(webhookEndpoint.active, true),
      ),
    );
  if (!ep) return null;
  const changeId = -now.getTime();
  const [row] = await db
    .insert(webhookDelivery)
    .values({
      endpointId,
      changeId,
      topic: WEBHOOK_TEST_TOPIC,
      payload: {
        id: String(changeId),
        topic: WEBHOOK_TEST_TOPIC,
        test: true,
        event_id: null,
        sport: null,
        competition_id: null,
        changed: [],
        data: { message: 'Entrega de teste do Galaxie Sports. A assinatura vale como numa mudança real.' },
        occurred_at: now.toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning({ id: webhookDelivery.id });
  return row?.id ?? null;
}

/** Recoloca na fila as entregas da DLQ do endpoint (tentativas zeradas). */
export async function replayTenantWebhookDead(
  db: Database,
  tenantId: string,
  endpointId: string,
): Promise<number> {
  const rows = await db.execute<{ id: number }>(sql`
    update api.webhook_delivery d
       set status = 'pending', attempts = 0, next_retry_at = now(), last_error = null
      from api.webhook_endpoint e
     where e.id = d.endpoint_id and e.tenant_id = ${tenantId} and d.endpoint_id = ${endpointId}
       and d.status = 'dead'
    returning d.id`);
  return rows.length;
}
