import { randomUUID } from 'node:crypto';
import { and, asc, gt, notInArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { RealtimeChange } from '@galaxie/contracts';
import { CHANGE_FEED_CHANNEL, changeFeed, type AbandonedGap, type Database } from '@galaxie/db';
import { toRealtimeChange } from './changes.js';
import { GapCursor } from './gap-cursor.js';

interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface ChangeStreamOptions {
  /** Valkey/Redis para o fan-out entre instâncias (pub/sub). Sem ele, o stream é local à instância. */
  redis?: Redis;
  keyPrefix?: string;
  /** Varredura do change feed além do NOTIFY. Padrão 1 s. */
  pollIntervalMs?: number;
  /** Duração da liderança do relay no Valkey. Padrão 10 s (renovada a cada ciclo). */
  leaseMs?: number;
  /** Tempo máximo de espera por um ID ausente (transação lenta) antes de pulá-lo. Padrão 90 s (GAP_TIMEOUT_MS). */
  gapTimeoutMs?: number;
  /** Lacuna abandonada (mudanças que o SSE não entregou): métrica `galaxie_change_feed_gaps_abandoned_total`. */
  onGapAbandoned?: (gap: AbandonedGap) => void;
  /** Usa LISTEN/NOTIFY para acordar na hora. Padrão true. */
  listen?: boolean;
  logger?: Logger;
}

export type ChangeListener = (change: RealtimeChange) => void;

const BATCH = 500;

/** Conjunto limitado dos IDs mais recentes (deduplicação de mensagens repetidas). */
export class RecentIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max: number) {}
  /** false se o ID já foi visto. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
}

// Renova a liderança se já for nossa; adquire se estiver livre.
const LEAD_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end
if v == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]) return 1 end
return 0`;

/**
 * Leva as mudanças públicas do `ops.change_feed` a todas as instâncias da API.
 *
 * - **Relay**: uma única instância por vez (liderança com lease no Valkey) lê o change feed —
 *   acordada pelo NOTIFY `ops_change_feed` e por varredura a cada `pollIntervalMs` — e publica
 *   cada mudança no canal `<prefixo>stream:changes`. O cursor fica no Valkey (`<prefixo>stream:cursor`,
 *   expira em 60 s sem relay ativo, para não despejar histórico velho em clientes novos).
 * - **Hub**: toda instância assina o canal e entrega aos ouvintes locais (conexões SSE), deduplicando
 *   por ID (troca de líder pode republicar algumas mudanças).
 *
 * Sem Valkey, a própria instância é o relay e entrega direto aos ouvintes locais.
 */
export class ChangeStream {
  private readonly listeners = new Set<ChangeListener>();
  private readonly recent = new RecentIds(10_000);
  private readonly instanceId = randomUUID();
  private readonly prefix: string;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private subscriber: Redis | undefined;
  private cursor: GapCursor | undefined;
  private timer: NodeJS.Timeout | undefined;
  private unlisten: (() => Promise<void>) | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private stopped = true;

  constructor(
    private readonly db: Database,
    private readonly options: ChangeStreamOptions = {},
  ) {
    this.prefix = options.keyPrefix ?? 'gs:';
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.leaseMs = options.leaseMs ?? 10_000;
  }

  private get channel(): string {
    return `${this.prefix}stream:changes`;
  }

  /** Registra um ouvinte local; devolve a função que o remove. */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** ID da mudança mais recente já publicada (ponto de retomada anunciado aos clientes). */
  async latestId(): Promise<number> {
    const [row] = await this.db.select({ max: sql<string | null>`max(${changeFeed.id})` }).from(changeFeed);
    return Number(row?.max ?? 0);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const { redis } = this.options;
    if (redis) {
      // conexão dedicada ao SUBSCRIBE (no modo assinante ela não aceita outros comandos); sem o commandTimeout
      // da conexão principal: o SUBSCRIBE fica na fila enquanto o Valkey está fora e sai quando ele volta
      this.subscriber = redis.duplicate({
        enableOfflineQueue: true,
        maxRetriesPerRequest: null,
        commandTimeout: undefined,
      });
      this.subscriber.on('error', (err) =>
        this.options.logger?.warn({ err }, 'stream: falha no Valkey (sub)'),
      );
      this.subscriber.on('message', (_channel: string, message: string) => {
        try {
          this.dispatch(JSON.parse(message) as RealtimeChange);
        } catch (err) {
          this.options.logger?.warn({ err }, 'stream: mensagem inválida no canal');
        }
      });
      const subscribed = this.subscriber.subscribe(this.channel);
      // não trava o boot se o Valkey estiver fora; o ioredis reassina ao reconectar
      await Promise.race([
        subscribed.catch((err) => this.options.logger?.warn({ err }, 'stream: SUBSCRIBE falhou')),
        new Promise((r) => setTimeout(r, 5_000).unref()),
      ]);
    }
    if (this.options.listen !== false) {
      const sub = await this.db.$client.listen(CHANGE_FEED_CHANNEL, () => void this.tick());
      this.unlisten = () => sub.unlisten();
    }
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref();
    await this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.unlisten?.().catch(() => {});
    await this.running;
    if (this.cursor && this.options.redis) {
      // devolve a liderança para outra instância assumir sem esperar o lease
      await this.options.redis
        .eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
          1,
          `${this.prefix}stream:relay`,
          this.instanceId,
        )
        .catch(() => {});
    }
    this.cursor = undefined;
    this.subscriber?.disconnect();
    this.subscriber = undefined;
  }

  /** Um ciclo do relay; chamadas concorrentes são coalescidas. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = this.relay()
      .catch((err) => this.options.logger?.warn({ err }, 'stream: falha no relay'))
      .finally(() => {
        this.running = undefined;
        if (this.pending && !this.stopped) {
          this.pending = false;
          void this.tick();
        }
      });
    return this.running;
  }

  private dispatch(change: RealtimeChange): void {
    if (!this.recent.add(change.id)) return;
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        this.options.logger?.warn({ err }, 'stream: ouvinte falhou');
      }
    }
  }

  private async lead(): Promise<boolean> {
    const { redis } = this.options;
    if (!redis) return true;
    const ok = await redis.eval(LEAD_SCRIPT, 1, `${this.prefix}stream:relay`, this.instanceId, this.leaseMs);
    return ok === 1;
  }

  private async relay(): Promise<void> {
    if (!(await this.lead())) {
      this.cursor = undefined;
      return;
    }
    const { redis } = this.options;
    const cursorKey = `${this.prefix}stream:cursor`;
    if (!this.cursor) {
      const stored = redis ? await redis.get(cursorKey) : null;
      const floor = stored != null ? Number(stored) : await this.latestId();
      this.cursor = new GapCursor(floor, {
        ...(this.options.gapTimeoutMs != null ? { gapTimeoutMs: this.options.gapTimeoutMs } : {}),
        onAbandon: (gap) => {
          this.options.logger?.warn({ gap }, 'stream: lacuna do change feed abandonada');
          this.options.onGapAbandoned?.(gap);
        },
      });
    }
    const cursor = this.cursor;
    for (;;) {
      const seen = cursor.seenIds;
      const rows = await this.db
        .select()
        .from(changeFeed)
        .where(
          and(gt(changeFeed.id, cursor.floor), seen.length ? notInArray(changeFeed.id, seen) : undefined),
        )
        .orderBy(asc(changeFeed.id))
        .limit(BATCH);
      for (const row of rows) {
        if (!cursor.isNew(row.id)) continue;
        const change = toRealtimeChange(row);
        if (!change) continue;
        if (redis) await redis.publish(this.channel, JSON.stringify(change));
        else this.dispatch(change);
      }
      cursor.mark(rows.map((r) => r.id));
      if (rows.length < BATCH) break;
    }
    cursor.advance();
    if (redis) await redis.set(cursorKey, String(cursor.floor), 'PX', 60_000);
  }
}
