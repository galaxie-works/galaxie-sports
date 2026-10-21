import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  REALTIME_TOPICS,
  tenant,
  webhookDelivery,
  webhookEndpoint,
  type Database,
  type RealtimeTopic,
  type WebhookFilters,
} from '@galaxie/db';
import { resolveTopic } from '@galaxie/contracts';
import { generateWebhookSecret } from './signature.js';

export interface WebhookInput {
  tenantSlug: string;
  url: string;
  /** Nomes curtos (score, status...) ou completos; vazio = todos os do plano. */
  topics?: string[];
  filters?: WebhookFilters;
  description?: string;
  /** Permite http:// para hosts que não são locais (padrão: só https, ou http em localhost). */
  allowInsecure?: boolean;
}

export class WebhookInputError extends Error {}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Valida a URL de destino: https, ou http apenas em host local (desenvolvimento). */
export function validateWebhookUrl(raw: string, allowInsecure = false): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookInputError(`URL inválida: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new WebhookInputError('A URL deve usar https://.');
  if (url.protocol === 'http:' && !allowInsecure && !LOCAL_HOSTS.has(url.hostname))
    throw new WebhookInputError('Use https:// (http:// só para localhost ou com --allow-http).');
  if (url.username || url.password) throw new WebhookInputError('A URL não pode conter credenciais.');
  return url.toString();
}

export function parseTopics(names: string[] = []): RealtimeTopic[] {
  const topics = names.map((n) => {
    const t = resolveTopic(n);
    if (!t) throw new WebhookInputError(`Tópico desconhecido: ${n}. Use ${REALTIME_TOPICS.join(', ')}.`);
    return t;
  });
  return [...new Set(topics)];
}

/** Cadastra um webhook para o tenant. O segredo volta só aqui — guarde-o. */
export async function createWebhookEndpoint(
  db: Database,
  input: WebhookInput,
): Promise<{ id: string; tenantId: string; secret: string; topics: RealtimeTopic[] }> {
  const url = validateWebhookUrl(input.url, input.allowInsecure);
  const topics = parseTopics(input.topics);
  const [t] = await db.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, input.tenantSlug));
  if (!t) throw new WebhookInputError(`Tenant não encontrado: ${input.tenantSlug}`);
  const secret = generateWebhookSecret();
  const [row] = await db
    .insert(webhookEndpoint)
    .values({
      tenantId: t.id,
      url,
      secret,
      topics,
      filters: input.filters ?? {},
      description: input.description ?? null,
    })
    .returning({ id: webhookEndpoint.id });
  return { id: row!.id, tenantId: t.id, secret, topics };
}

export async function listWebhookEndpoints(db: Database, tenantSlug?: string) {
  return db
    .select({
      id: webhookEndpoint.id,
      tenant: tenant.slug,
      url: webhookEndpoint.url,
      topics: webhookEndpoint.topics,
      filters: webhookEndpoint.filters,
      active: webhookEndpoint.active,
      createdAt: webhookEndpoint.createdAt,
      pending: sql<number>`(select count(*)::int from api.webhook_delivery d where d.endpoint_id = ${webhookEndpoint.id} and d.status = 'pending')`,
      dead: sql<number>`(select count(*)::int from api.webhook_delivery d where d.endpoint_id = ${webhookEndpoint.id} and d.status = 'dead')`,
    })
    .from(webhookEndpoint)
    .innerJoin(tenant, eq(tenant.id, webhookEndpoint.tenantId))
    .where(tenantSlug ? eq(tenant.slug, tenantSlug) : undefined)
    .orderBy(tenant.slug, webhookEndpoint.createdAt);
}

export async function setWebhookActive(db: Database, id: string, active: boolean): Promise<boolean> {
  const rows = await db
    .update(webhookEndpoint)
    .set({ active, updatedAt: new Date() })
    .where(eq(webhookEndpoint.id, id))
    .returning({ id: webhookEndpoint.id });
  return rows.length > 0;
}

/** Entregas na DLQ (status `dead`), mais recentes primeiro. */
export async function listDeadDeliveries(
  db: Database,
  options: { endpointId?: string; limit?: number } = {},
) {
  return db
    .select({
      id: webhookDelivery.id,
      endpointId: webhookDelivery.endpointId,
      changeId: webhookDelivery.changeId,
      topic: webhookDelivery.topic,
      attempts: webhookDelivery.attempts,
      responseCode: webhookDelivery.responseCode,
      lastError: webhookDelivery.lastError,
      lastAttemptAt: webhookDelivery.lastAttemptAt,
    })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.status, 'dead'),
        options.endpointId ? eq(webhookDelivery.endpointId, options.endpointId) : undefined,
      ),
    )
    .orderBy(desc(webhookDelivery.id))
    .limit(options.limit ?? 50);
}

/** Recoloca entregas da DLQ na fila (tentativas zeradas). Sem ids, reenfileira todas as do endpoint. */
export async function replayDeadDeliveries(
  db: Database,
  target: { ids: number[] } | { endpointId: string },
): Promise<number> {
  const rows = await db
    .update(webhookDelivery)
    .set({ status: 'pending', attempts: 0, nextRetryAt: new Date(), lastError: null })
    .where(
      and(
        eq(webhookDelivery.status, 'dead'),
        'ids' in target
          ? inArray(webhookDelivery.id, target.ids)
          : eq(webhookDelivery.endpointId, target.endpointId),
      ),
    )
    .returning({ id: webhookDelivery.id });
  return rows.length;
}
