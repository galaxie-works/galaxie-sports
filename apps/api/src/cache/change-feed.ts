import { asc, gt, sql } from 'drizzle-orm';
import { CHANGE_FEED_CHANNEL, changeFeed, type Database } from '@galaxie/db';
import type { CdnPurger } from './purger.js';
import type { ResponseCache } from './store.js';

export interface ChangeRow {
  id: number;
  topic: string;
  entityType: string;
  entityId: string;
  payload: unknown;
}

/**
 * Tags afetadas por uma mudança: a entidade (`competition:<id>`), a coleção (`competition`)
 * e as tags extras em `payload.tags`. Convenções de tag em docs/05 §7.
 */
export function tagsForChange(change: Pick<ChangeRow, 'entityType' | 'entityId' | 'payload'>): string[] {
  const tags = [`${change.entityType}:${change.entityId}`, change.entityType];
  const extra = (change.payload as { tags?: unknown } | null)?.tags;
  if (Array.isArray(extra)) for (const t of extra) if (typeof t === 'string') tags.push(t);
  return [...new Set(tags)];
}

interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface ChangeFeedOptions {
  /** Varredura periódica além do NOTIFY (cobre writers que não notificam). Padrão 5 s. */
  pollIntervalMs?: number;
  /** Usa LISTEN/NOTIFY para acordar na hora. Padrão true. */
  listen?: boolean;
  logger?: Logger;
}

/**
 * Consome `ops.change_feed` e purga o cache (Valkey + CDN). Acorda via LISTEN `ops_change_feed`
 * e também varre periodicamente, então a propagação fica limitada a `pollIntervalMs` mesmo sem NOTIFY.
 * Começa do id mais recente no momento do start (mudanças antigas já não estão em cache).
 */
export class ChangeFeedListener {
  private lastId = 0;
  private timer: NodeJS.Timeout | undefined;
  private unlisten: (() => Promise<void>) | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private stopped = true;
  readonly pollIntervalMs: number;

  constructor(
    private readonly db: Database,
    private readonly cache: ResponseCache,
    private readonly cdn: CdnPurger,
    private readonly options: ChangeFeedOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const [row] = await this.db.select({ max: sql<string | null>`max(${changeFeed.id})` }).from(changeFeed);
    this.lastId = Number(row?.max ?? 0);
    if (this.options.listen !== false) {
      const sub = await this.db.$client.listen(CHANGE_FEED_CHANNEL, () => void this.poll());
      this.unlisten = () => sub.unlisten();
    }
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.unlisten?.().catch(() => {});
    await this.running;
  }

  /** Processa as mudanças novas; chamadas concorrentes são coalescidas. */
  poll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = this.drain()
      .catch((err) => this.options.logger?.warn({ err }, 'change feed: falha ao purgar'))
      .finally(() => {
        this.running = undefined;
        if (this.pending && !this.stopped) {
          this.pending = false;
          void this.poll();
        }
      });
    return this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const rows = await this.db
        .select({
          id: changeFeed.id,
          topic: changeFeed.topic,
          entityType: changeFeed.entityType,
          entityId: changeFeed.entityId,
          payload: changeFeed.payload,
        })
        .from(changeFeed)
        .where(gt(changeFeed.id, this.lastId))
        .orderBy(asc(changeFeed.id))
        .limit(500);
      if (!rows.length) return;
      const tags = [...new Set(rows.flatMap(tagsForChange))];
      const purged = await this.cache.purgeTags(tags);
      await this.cdn.purgeTags(tags);
      this.lastId = rows.at(-1)!.id;
      this.options.logger?.info(
        { changes: rows.length, tags: tags.length, purged },
        'change feed: cache purgado',
      );
      if (rows.length < 500) return;
    }
  }
}
