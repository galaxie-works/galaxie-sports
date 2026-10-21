import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { changeFeed } from './schema/ops.js';

/** Canal do LISTEN/NOTIFY usado para acordar os consumidores do change feed (purge de cache, SSE...). */
export const CHANGE_FEED_CHANNEL = 'ops_change_feed';

export interface ChangeInput {
  /** Ex.: catalog, standings, event, where_to_watch, raw. */
  topic: string;
  /** Ex.: competition, season, standing, venue, country, sport, event, api_response. */
  entityType: string;
  entityId: string;
  /** Dados livres; `tags` (string[]) acrescenta tags de cache a purgar. */
  payload?: Record<string, unknown> | null;
}

/**
 * Publica uma mudança no `ops.change_feed` e notifica os ouvintes na mesma transação
 * (o NOTIFY só é entregue no commit). Use em todo writer que altera dados servidos pela API.
 */
export async function publishChange(db: Database, change: ChangeInput): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(changeFeed)
      .values({
        topic: change.topic,
        entityType: change.entityType,
        entityId: change.entityId,
        payload: change.payload ?? null,
      })
      .returning({ id: changeFeed.id });
    await tx.execute(sql`select pg_notify(${CHANGE_FEED_CHANNEL}, ${String(row!.id)})`);
    return row!.id;
  });
}
