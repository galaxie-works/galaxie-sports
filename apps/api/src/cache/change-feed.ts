import { and, asc, eq, gt, notInArray, sql } from 'drizzle-orm';
import {
  CHANGE_FEED_CHANNEL,
  changeFeed,
  changeFeedCursor,
  GapCursor,
  tagsForChange,
  type AbandonedGap,
  type Database,
} from '@galaxie/db';
import type { CdnPurger } from './purger.js';
import type { ResponseCache } from './store.js';

/** Tags de uma mudança: a regra mora em @galaxie/db, a mesma que a demo usa para revalidar o cache dela. */
export { tagsForChange };

export interface ChangeRow {
  id: number;
  topic: string;
  entityType: string;
  entityId: string;
  payload: unknown;
}

/** Espera padrão por um id pulado no change feed antes de abandoná-lo (ver ChangeFeedOptions.gapTimeoutMs). */
export const PURGE_GAP_TIMEOUT_MS = 90_000;

interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface ChangeFeedOptions {
  /** Varredura periódica além do NOTIFY (cobre writers que não notificam). Padrão 5 s. */
  pollIntervalMs?: number;
  /** Usa LISTEN/NOTIFY para acordar na hora. Padrão true. */
  listen?: boolean;
  /**
   * Quanto esperar por um id pulado (transação mais lenta) antes de desistir dele. Padrão 90 s: um purge que
   * chega tarde não faz mal e um perdido deixa a resposta velha até o TTL.
   */
  gapTimeoutMs?: number;
  /** Lacuna abandonada (purge que pode ter faltado): métrica `galaxie_change_feed_gaps_abandoned_total`. */
  onGapAbandoned?: (gap: AbandonedGap) => void;
  /** Linha do cursor em `api.change_feed_cursor`. Padrão `cache-purge`. */
  cursorName?: string;
  /** Retoma do cursor salvo se ele tiver no máximo esta idade. Padrão 24 h (o maior TTL do cache). */
  resumeMaxAgeMs?: number;
  /** ...e estiver no máximo estas mudanças atrás do fim do change feed. Padrão 50 000. */
  resumeMaxLag?: number;
  /** Intervalo mínimo entre gravações do cursor. Padrão 5 s (a parada grava o último). */
  saveEveryMs?: number;
  now?: () => number;
  logger?: Logger;
}

/**
 * Consome `ops.change_feed` e purga o cache (Valkey + CDN). Acorda via LISTEN `ops_change_feed`
 * e também varre periodicamente, então a propagação fica limitada a `pollIntervalMs` mesmo sem NOTIFY.
 * O piso fica salvo em `api.change_feed_cursor`: depois de um restart (deploy), retoma de onde parou e purga o
 * que mudou enquanto a API estava fora (o Valkey guarda as respostas entre os deploys). Sem cursor salvo, ou
 * com ele velho demais, começa do id mais recente.
 * Lê com o GapCursor (como o ChangeStream e o worker de webhooks): uma transação que pegou um id menor e
 * comitou depois de um id maior já lido ainda é purgada.
 */
export class ChangeFeedListener {
  private cursor = new GapCursor(0);
  private timer: NodeJS.Timeout | undefined;
  private unlisten: (() => Promise<void>) | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private stopped = true;
  private savedFloor: number | undefined;
  private savedAt = 0;
  readonly pollIntervalMs: number;
  private readonly cursorName: string;
  private readonly now: () => number;

  constructor(
    private readonly db: Database,
    private readonly cache: ResponseCache,
    private readonly cdn: CdnPurger,
    private readonly options: ChangeFeedOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.cursorName = options.cursorName ?? 'cache-purge';
    this.now = options.now ?? Date.now;
  }

  /** Piso atual (todos os ids até ele já purgados ou abandonados). */
  get floor(): number {
    return this.cursor.floor;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const [row] = await this.db.select({ max: sql<string | null>`max(${changeFeed.id})` }).from(changeFeed);
    const latest = Number(row?.max ?? 0);
    const saved = await this.loadCursor().catch((err: unknown) => {
      this.options.logger?.warn({ err }, 'change feed: cursor do purge ilegível; partindo do mais recente');
      return undefined;
    });
    const resumable =
      saved != null &&
      saved.lastId <= latest &&
      this.now() - saved.updatedAt.getTime() <= (this.options.resumeMaxAgeMs ?? 24 * 3_600_000) &&
      latest - saved.lastId <= (this.options.resumeMaxLag ?? 50_000);
    if (saved && !resumable)
      this.options.logger?.warn(
        { saved: saved.lastId, latest, updatedAt: saved.updatedAt },
        'change feed: cursor do purge velho demais; partindo do mais recente',
      );
    this.cursor = new GapCursor(resumable ? saved.lastId : latest, {
      gapTimeoutMs: this.options.gapTimeoutMs ?? PURGE_GAP_TIMEOUT_MS,
      ...(this.options.now ? { now: this.options.now } : {}),
      onAbandon: (gap) => {
        this.options.logger?.warn({ gap }, 'change feed: lacuna abandonada (purge pode ter faltado)');
        this.options.onGapAbandoned?.(gap);
      },
    });
    if (resumable) this.savedFloor = saved.lastId;
    else await this.persist(true);
    if (this.options.listen !== false) {
      const sub = await this.db.$client.listen(CHANGE_FEED_CHANNEL, () => void this.poll());
      this.unlisten = () => sub.unlisten();
    }
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref();
    // o que mudou enquanto a API estava fora é purgado já na subida
    if (resumable && saved.lastId < latest) {
      this.options.logger?.info({ from: saved.lastId, latest }, 'change feed: retomando o purge');
      void this.poll();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.unlisten?.().catch(() => {});
    await this.running;
    await this.persist(true);
  }

  private async loadCursor(): Promise<{ lastId: number; updatedAt: Date } | undefined> {
    const [row] = await this.db
      .select({ lastId: changeFeedCursor.lastChangeId, updatedAt: changeFeedCursor.updatedAt })
      .from(changeFeedCursor)
      .where(eq(changeFeedCursor.name, this.cursorName));
    return row;
  }

  /** Grava o piso (no máximo a cada `saveEveryMs`, ou já com `force`); falha só vira aviso. */
  private async persist(force: boolean): Promise<void> {
    const floor = this.cursor.floor;
    if (floor === this.savedFloor) return;
    if (!force && this.now() - this.savedAt < (this.options.saveEveryMs ?? 5_000)) return;
    try {
      await this.db
        .insert(changeFeedCursor)
        .values({ name: this.cursorName, lastChangeId: floor })
        .onConflictDoUpdate({
          target: changeFeedCursor.name,
          set: { lastChangeId: floor, updatedAt: sql`now()` },
        });
      this.savedFloor = floor;
      this.savedAt = this.now();
    } catch (err) {
      this.options.logger?.warn({ err }, 'change feed: falha ao gravar o cursor do purge');
    }
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
    const cursor = this.cursor;
    for (;;) {
      const seen = cursor.seenIds;
      const rows = await this.db
        .select({
          id: changeFeed.id,
          topic: changeFeed.topic,
          entityType: changeFeed.entityType,
          entityId: changeFeed.entityId,
          payload: changeFeed.payload,
        })
        .from(changeFeed)
        .where(
          and(gt(changeFeed.id, cursor.floor), seen.length ? notInArray(changeFeed.id, seen) : undefined),
        )
        .orderBy(asc(changeFeed.id))
        .limit(500);
      const fresh = rows.filter((r) => cursor.isNew(r.id));
      if (fresh.length) {
        const tags = [...new Set(fresh.flatMap(tagsForChange))];
        const purged = await this.cache.purgeTags(tags);
        await this.cdn.purgeTags(tags);
        this.options.logger?.info(
          { changes: fresh.length, tags: tags.length, purged },
          'change feed: cache purgado',
        );
      }
      // só marca depois do purge: se ele falhar, as mesmas linhas voltam na próxima varredura
      cursor.mark(rows.map((r) => r.id));
      if (rows.length < 500) break;
    }
    // lacuna vencida (transação revertida, sequência pulada) é abandonada mesmo sem linhas novas
    cursor.advance();
    await this.persist(false);
  }
}
