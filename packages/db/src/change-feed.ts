import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/** Marca d'água dos consumidores do change feed (SSE, webhooks, cache da demo). */
export { GapCursor } from './gap-cursor.js';

/** Canal do LISTEN/NOTIFY usado para acordar os consumidores do change feed (purge de cache, SSE...). */
export const CHANGE_FEED_CHANNEL = 'ops_change_feed';

export interface ChangeInput {
  /** Ex.: catalog, standings, event.score_changed, where_to_watch.changed. */
  topic: string;
  /** Ex.: competition, season, standing, venue, country, sport, event, where_to_watch, api_response. */
  entityType: string;
  entityId: string;
  /** Dados livres; `tags` (string[]) acrescenta tags de cache a purgar. */
  payload?: Record<string, unknown> | null;
}

/** Executor aceito por publishChange: o banco ou uma transação aberta. */
type Executor = Pick<Database, 'execute'>;

/**
 * Publica uma mudança no `ops.change_feed` e notifica os ouvintes (o NOTIFY só é entregue no commit).
 * Usa `ops.publish_change`, a mesma função dos triggers de captura (migration 0006): a mesma
 * (tópico, entidade) publicada duas vezes na mesma transação — por um trigger e pelo app, por
 * exemplo — vira uma única linha com os payloads fundidos. Mudanças em `core.event`,
 * `core.event_incident`, `enrich.broadcast_option` e `enrich.event_context` já são capturadas
 * pelos triggers; use publishChange para os demais writers (catálogo, tabelas, espelho...).
 */
export async function publishChange(db: Executor, change: ChangeInput): Promise<number> {
  const payload = change.payload == null ? null : JSON.stringify(change.payload);
  const rows = await db.execute<{ id: string }>(
    sql`select ops.publish_change(${change.topic}, ${change.entityType}, ${change.entityId}, ${payload}::jsonb)::text as id`,
  );
  return Number(rows[0]!.id);
}

/** O que define as tags de uma mudança (subconjunto de uma linha de `ops.change_feed`). */
export interface ChangeTagSource {
  entityType: string;
  entityId: string;
  payload: unknown;
}

/**
 * Tags de cache afetadas por uma mudança: a entidade (`competition:<id>`), a coleção (`competition`)
 * e as tags extras em `payload.tags`. Convenções de tag em docs/05 §7. A API purga o Valkey e a CDN
 * com elas; a demo revalida o cache do Next (`cacheTag`) com as mesmas.
 */
export function tagsForChange(change: ChangeTagSource): string[] {
  const tags = [`${change.entityType}:${change.entityId}`, change.entityType];
  const extra = (change.payload as { tags?: unknown } | null)?.tags;
  if (Array.isArray(extra)) for (const t of extra) if (typeof t === 'string') tags.push(t);
  return [...new Set(tags)];
}
