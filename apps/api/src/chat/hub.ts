/**
 * Lotes do Chat ao vivo (#964). A mensagem aprovada não vai direto para as telas: entra na fila da sala e, a cada
 * `intervalMs` (1 s), sai num lote só. Custo previsível: com mil mensagens por segundo numa sala, cada tela recebe um
 * evento por segundo, não mil (regra 8 do épico).
 *
 * Com Valkey (várias instâncias da API):
 *
 * - **fila**: `RPUSH <prefixo>chat:q:<sala>` + `SADD <prefixo>chat:q:rooms <sala>`;
 * - **lote**: toda instância roda o relógio; o script `TAKE` tira a fila inteira da sala de forma atômica, numera o
 *   lote (`INCR <prefixo>chat:seq:<sala>`), guarda no histórico curto (`chat:h:<sala>`, para a reconexão) e publica
 *   em `<prefixo>chat:batches`. Duas instâncias no mesmo segundo nunca levam a mesma mensagem: a segunda acha a
 *   fila vazia;
 * - **entrega**: toda instância assina o canal e entrega aos ouvintes locais da sala (as conexões SSE).
 *
 * Sem Valkey, o mesmo desenho em memória, local à instância.
 *
 * A sala é a chave `<tenant>:<jogo>` (uma sala por jogo e cliente): o lote de um cliente nunca chega à conexão de
 * outro.
 */
import type { Redis } from 'ioredis';
import type { ChatMessage } from '@galaxie/contracts';

export interface ChatBatch {
  /** `<tenant>:<jogo>`. */
  room: string;
  /** Sequencial por sala, começa em 1: o `id:` do evento SSE e o cursor da reconexão. */
  id: number;
  messages: ChatMessage[];
}

export type ChatBatchListener = (batch: ChatBatch) => void;

export interface ChatHubOptions {
  redis?: Redis | undefined;
  keyPrefix?: string;
  /** Intervalo do lote. Padrão 1 s. */
  intervalMs?: number;
  /** Lotes guardados por sala para a reconexão. Padrão 120 (2 min com uma mensagem por segundo). */
  historySize?: number;
  /** Máximo de mensagens num lote; o resto fica para o próximo. Padrão 200. */
  maxPerBatch?: number;
  logger?: { warn(obj: object, msg?: string): void };
}

// KEYS: fila, conjunto de salas pendentes, sequência, histórico, canal
// ARGV: sala, máximo por lote, tamanho do histórico, ttl do histórico (ms)
const TAKE_SCRIPT = `
local items = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[2]) - 1)
if #items == 0 then redis.call('SREM', KEYS[2], ARGV[1]) return 0 end
redis.call('LTRIM', KEYS[1], #items, -1)
if redis.call('LLEN', KEYS[1]) == 0 then redis.call('SREM', KEYS[2], ARGV[1]) end
local id = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[4]) * 10)
local batch = '{"room":' .. cjson.encode(ARGV[1]) .. ',"id":' .. id .. ',"messages":[' .. table.concat(items, ',') .. ']}'
redis.call('ZADD', KEYS[4], id, batch)
redis.call('ZREMRANGEBYRANK', KEYS[4], 0, -1 - tonumber(ARGV[3]))
redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[4]))
redis.call('PUBLISH', KEYS[5], batch)
return id`;

const HISTORY_TTL_MS = 6 * 3600_000;

export class ChatHub {
  private readonly listeners = new Map<string, Set<ChatBatchListener>>();
  private readonly prefix: string;
  private readonly intervalMs: number;
  private readonly historySize: number;
  private readonly maxPerBatch: number;
  private subscriber: Redis | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  // sem Valkey
  private readonly memQueue = new Map<string, ChatMessage[]>();
  private readonly memSeq = new Map<string, number>();
  private readonly memHistory = new Map<string, ChatBatch[]>();

  constructor(private readonly options: ChatHubOptions = {}) {
    this.prefix = options.keyPrefix ?? 'gs:';
    this.intervalMs = options.intervalMs ?? 1_000;
    this.historySize = options.historySize ?? 120;
    this.maxPerBatch = options.maxPerBatch ?? 200;
  }

  static roomKey(tenantId: string, fixtureId: string): string {
    return `${tenantId}:${fixtureId}`;
  }

  private k(name: string, room?: string): string {
    return room ? `${this.prefix}chat:${name}:${room}` : `${this.prefix}chat:${name}`;
  }

  /** Ouve os lotes de uma sala; devolve a função que para de ouvir. */
  subscribe(room: string, listener: ChatBatchListener): () => void {
    const set = this.listeners.get(room) ?? new Set();
    set.add(listener);
    this.listeners.set(room, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(room);
    };
  }

  /** Ouvintes locais (conexões nesta instância) da sala. */
  localListeners(room: string): number {
    return this.listeners.get(room)?.size ?? 0;
  }

  /** Põe a mensagem aprovada na fila da sala; sai no próximo lote. */
  async enqueue(room: string, message: ChatMessage): Promise<void> {
    const { redis } = this.options;
    if (!redis) {
      const q = this.memQueue.get(room) ?? [];
      q.push(message);
      this.memQueue.set(room, q);
      return;
    }
    await redis
      .multi()
      .rpush(this.k('q', room), JSON.stringify(message))
      .pexpire(this.k('q', room), HISTORY_TTL_MS)
      .sadd(this.k('q:rooms'), room)
      .exec();
  }

  /** Último lote da sala (0 = nenhum ainda): o ponto de partida de quem entra agora. */
  async latestId(room: string): Promise<number> {
    const { redis } = this.options;
    if (!redis) return this.memSeq.get(room) ?? 0;
    return Number((await redis.get(this.k('seq', room))) ?? 0);
  }

  /**
   * Lotes depois de `afterId`, em ordem. `complete = false` quando parte deles já saiu do histórico curto (o cliente
   * relê a sala pelo GET).
   */
  async since(room: string, afterId: number): Promise<{ batches: ChatBatch[]; complete: boolean }> {
    const { redis } = this.options;
    let batches: ChatBatch[];
    if (!redis) batches = (this.memHistory.get(room) ?? []).filter((b) => b.id > afterId);
    else {
      const raw = await redis.zrangebyscore(this.k('h', room), `(${afterId}`, '+inf');
      batches = raw.map((r) => JSON.parse(r) as ChatBatch);
    }
    const latest = await this.latestId(room);
    const complete = afterId >= latest || batches[0]?.id === afterId + 1;
    return { batches, complete };
  }

  async start(): Promise<void> {
    const { redis } = this.options;
    if (redis) {
      this.subscriber = redis.duplicate({
        enableOfflineQueue: true,
        maxRetriesPerRequest: null,
        commandTimeout: undefined,
      });
      this.subscriber.on('error', (err) => this.options.logger?.warn({ err }, 'chat: falha no Valkey (sub)'));
      this.subscriber.on('message', (_channel: string, message: string) => {
        try {
          this.dispatch(JSON.parse(message) as ChatBatch);
        } catch (err) {
          this.options.logger?.warn({ err }, 'chat: lote inválido no canal');
        }
      });
      await Promise.race([
        this.subscriber
          .subscribe(this.k('batches'))
          .catch((err) => this.options.logger?.warn({ err }, 'chat: SUBSCRIBE falhou')),
        new Promise((r) => setTimeout(r, 5_000).unref()),
      ]);
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
    this.subscriber?.disconnect();
    this.subscriber = undefined;
  }

  /** Um ciclo: fecha o lote de cada sala com fila. Chamadas concorrentes esperam a que está rodando. */
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.flush()
      .catch((err) => this.options.logger?.warn({ err }, 'chat: falha ao fechar lotes'))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async flush(): Promise<void> {
    const { redis } = this.options;
    if (!redis) {
      for (const [room, queue] of this.memQueue) {
        const messages = queue.splice(0, this.maxPerBatch);
        if (!queue.length) this.memQueue.delete(room);
        if (!messages.length) continue;
        const id = (this.memSeq.get(room) ?? 0) + 1;
        this.memSeq.set(room, id);
        const batch: ChatBatch = { room, id, messages };
        const h = this.memHistory.get(room) ?? [];
        h.push(batch);
        if (h.length > this.historySize) h.splice(0, h.length - this.historySize);
        this.memHistory.set(room, h);
        this.dispatch(batch);
      }
      return;
    }
    const rooms = await redis.smembers(this.k('q:rooms'));
    for (const room of rooms)
      await redis.eval(
        TAKE_SCRIPT,
        5,
        this.k('q', room),
        this.k('q:rooms'),
        this.k('seq', room),
        this.k('h', room),
        this.k('batches'),
        room,
        this.maxPerBatch,
        this.historySize,
        HISTORY_TTL_MS,
      );
  }

  private dispatch(batch: ChatBatch): void {
    const set = this.listeners.get(batch.room);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(batch);
      } catch (err) {
        this.options.logger?.warn({ err }, 'chat: ouvinte falhou');
      }
    }
  }
}
