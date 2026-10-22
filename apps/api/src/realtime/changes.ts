import { CHANGE_TOPICS, type ChangeTopic, type RealtimeChange } from '@galaxie/contracts';
import { REALTIME_TOPICS, type ApiModule } from '@galaxie/db';

// Os tópicos do banco (triggers) e os do contrato precisam ser idênticos.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const TOPICS_MATCH: Same<(typeof REALTIME_TOPICS)[number], ChangeTopic> = true;

/** Módulo do plano exigido por tópico (docs/05 §1.1). */
export const TOPIC_MODULE: Record<ChangeTopic, ApiModule> = {
  'event.status_changed': 'core_data',
  'event.score_changed': 'core_data',
  'event.incident_added': 'core_data',
  'where_to_watch.changed': 'where_to_watch',
  'event.context_published': 'live_intelligence',
  'event.related_content_changed': 'related_content',
};

export function isChangeTopic(topic: string): topic is ChangeTopic {
  return (CHANGE_TOPICS as readonly string[]).includes(topic);
}

/** Linha de `ops.change_feed`. */
export interface ChangeRow {
  id: number;
  topic: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: Date;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Forma pública (SSE `data:` e corpo do webhook); `undefined` para tópicos internos (catálogo, espelho,
 * `live` do Live Poller...). O ao vivo chega aos clientes pelos tópicos dos triggers de `core.event` e
 * `core.event_incident`, que disparam quando o poller grava — o `live` só purga cache (docs/05 §5).
 */
export function toRealtimeChange(row: ChangeRow): RealtimeChange | undefined {
  if (!isChangeTopic(row.topic)) return undefined;
  const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  const previous = p.previous && typeof p.previous === 'object' ? p.previous : undefined;
  return {
    id: String(row.id),
    topic: row.topic,
    event_id: str(p.event_id) ?? row.entityId,
    sport: str(p.sport),
    competition_id: str(p.competition_id),
    changed: Array.isArray(p.changed) ? p.changed.filter((c): c is string => typeof c === 'string') : [],
    data: (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, unknown>,
    ...(previous ? { previous: previous as Record<string, unknown> } : {}),
    occurred_at: row.createdAt.toISOString(),
  };
}

/** Escopo contratado do tenant (subconjunto de TenantContext). */
export interface TenantScope {
  modules: readonly ApiModule[];
  /** Países; vazio = todos. */
  markets: readonly string[];
  /** Esportes; vazio = todos. */
  sports: readonly string[];
}

/** Filtros pedidos pelo cliente (SSE) ou configurados no webhook. Conjuntos vazios = sem restrição. */
export interface ChangeFilter {
  topics: ReadonlySet<ChangeTopic>;
  events?: ReadonlySet<string>;
  competitions?: ReadonlySet<string>;
  sports?: ReadonlySet<string>;
}

export function topicsForTenant(tenant: TenantScope): ChangeTopic[] {
  return CHANGE_TOPICS.filter((t) => tenant.modules.includes(TOPIC_MODULE[t]));
}

const restricts = (set: ReadonlySet<string> | undefined): set is ReadonlySet<string> => !!set && set.size > 0;

/**
 * Aplica os filtros e o contrato do tenant (módulos, esportes, mercados). Devolve a mudança — com
 * `data.countries` recortado aos mercados do tenant no onde assistir — ou `undefined` se não se aplica.
 */
export function scopeChange(
  change: RealtimeChange,
  filter: ChangeFilter,
  tenant: TenantScope,
): RealtimeChange | undefined {
  if (!filter.topics.has(change.topic)) return undefined;
  if (!tenant.modules.includes(TOPIC_MODULE[change.topic])) return undefined;
  if (tenant.sports.length && change.sport && !tenant.sports.includes(change.sport)) return undefined;
  if (restricts(filter.events) && !filter.events.has(change.event_id)) return undefined;
  if (restricts(filter.sports) && !(change.sport && filter.sports.has(change.sport))) return undefined;
  if (
    restricts(filter.competitions) &&
    !(change.competition_id && filter.competitions.has(change.competition_id))
  )
    return undefined;
  if (change.topic === 'where_to_watch.changed' && tenant.markets.length) {
    const countries = Array.isArray(change.data.countries) ? (change.data.countries as unknown[]) : [];
    const allowed = countries.filter(
      (c) => typeof c === 'string' && tenant.markets.includes(c.toUpperCase()),
    );
    if (!allowed.length) return undefined;
    if (allowed.length !== countries.length)
      return { ...change, data: { ...change.data, countries: allowed } };
  }
  return change;
}
