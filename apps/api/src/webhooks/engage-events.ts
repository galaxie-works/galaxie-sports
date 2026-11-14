/**
 * Eventos de engajamento para webhooks (#1023): linhas do `ops.change_feed` publicadas por `publishWebhookEvent`
 * (`@galaxie/db`) com um tópico do registro (`@galaxie/contracts`, webhook-topics.ts).
 *
 * Diferente dos tópicos de dados, que valem para todo tenant com o módulo, um evento de engajamento é de um tenant
 * só (`tenant_id` no payload do change feed, que nunca sai no corpo). O corpo é montado pelo schema do registro:
 * campo não declarado é descartado, então dado pessoal que entre por engano no change feed não chega ao cliente.
 */
import {
  isEngageWebhookTopic,
  webhookTopic,
  webhookTopicEnabled,
  type WebhookTopicDef,
} from '@galaxie/contracts';
import type { ChangeRow } from '../realtime/changes.js';

export interface EngageWebhookEvent {
  tenantId: string;
  def: WebhookTopicDef;
  /** Corpo do POST, já passado pelo schema do tópico. */
  body: unknown;
}

/** O endpoint como o worker o vê: o tenant, os módulos ligados nele e os tópicos marcados (vazio = todos). */
export interface EngageEndpointScope {
  tenantId: string;
  modules: readonly string[];
  topics: readonly string[];
}

/**
 * Monta o evento a partir da linha do change feed. `undefined` se a linha não é um tópico de engajamento;
 * `{ invalid }` se é, mas o payload não bate com o schema do registro (não sai, e o worker registra no log).
 */
export function toEngageWebhook(row: ChangeRow): EngageWebhookEvent | { invalid: string } | undefined {
  if (!isEngageWebhookTopic(row.topic)) return undefined;
  const def = webhookTopic(row.topic)!;
  const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  if (typeof p.tenant_id !== 'string' || !p.tenant_id) return { invalid: 'sem tenant_id' };
  const parsed = def.payload.safeParse({
    id: String(row.id),
    topic: row.topic,
    occurred_at: row.createdAt.toISOString(),
    data: p.data,
  });
  if (!parsed.success) return { invalid: parsed.error.message };
  return { tenantId: p.tenant_id, def, body: parsed.data };
}

/**
 * O evento vai para este endpoint? Só do mesmo tenant, com um módulo do tópico ligado, e com o tópico marcado ou,
 * sem tópico marcado, se ele já é emitido (`live`): um tópico "em breve" não entra no "todos" por conta própria.
 */
export function engageEventMatches(event: EngageWebhookEvent, ep: EngageEndpointScope): boolean {
  if (event.tenantId !== ep.tenantId) return false;
  if (!webhookTopicEnabled(event.def, ep.modules)) return false;
  return ep.topics.length ? ep.topics.includes(event.def.topic) : event.def.status === 'live';
}
