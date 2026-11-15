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

export interface ChatBatch {
  /** `<tenant>:<jogo>`. */
  room: string;
  /**
   * Época da sequência: muda se o Valkey perder a sequência (reinício sem persistência, expiração). Com ela o cliente
   * sabe que o número recomeçou e relê a sala, em vez de descartar os lotes novos por número "velho".
   */
  epoch: string;
  /** Sequencial por sala dentro da época, começa em 1. O `id:` do evento SSE é `<época>-<número>`. */
  id: number;
  /** Mensagens do lote: da sala (`ChatMessage`) ou do jogo (`GameMessageView`, sala `game:<jogo>`). */
  messages: object[];
}

/** Onde a conexão está: época e último lote entregue (0 = nenhum). */
export interface ChatCursor {
  epoch: string;
  id: number;
}

/** `<época>-<número>`, o `id:` do evento SSE. */
export const formatCursor = (c: ChatCursor): string => `${c.epoch}-${c.id}`;
export function parseCursor(raw: string | undefined): ChatCursor | null | undefined {
  if (raw == null || raw === '') return undefined;
  const m = /^(\d{1,16})-(\d{1,12})$/.exec(raw);
  return m ? { epoch: m[1]!, id: Number(m[2]) } : null;
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
  /**
   * Teto da fila da sala. Acima dele saem as mais antigas (já estão no banco e no GET): a fila nunca cresce sem limite
   * nem atrasa a sala em minutos. Padrão 2000 (10 lotes cheios).
   */
  maxQueue?: number;
  now?: () => number;
  logger?: { warn(obj: object, msg?: string): void };
}

// KEYS: fila, conjunto de salas pendentes, sequência, histórico, canal, época
// ARGV: sala, máximo por lote, tamanho do histórico, ttl do histórico (ms), época nova (ms agora)
const TAKE_SCRIPT = `
local items = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[2]) - 1)
if #items == 0 then redis.call('SREM', KEYS[2], ARGV[1]) return 0 end
redis.call('LTRIM', KEYS[1], #items, -1)
if redis.call('LLEN', KEYS[1]) == 0 then redis.call('SREM', KEYS[2], ARGV[1]) end
local id = redis.call('INCR', KEYS[3])
local epoch = redis.call('GET', KEYS[6])
if id == 1 or not epoch then
  epoch = ARGV[5]
  redis.call('SET', KEYS[6], epoch)
  if id ~= 1 then id = 1 redis.call('SET', KEYS[3], 1) end
  redis.call('DEL', KEYS[4])
end
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[4]) * 10)
redis.call('PEXPIRE', KEYS[6], tonumber(ARGV[4]) * 10)
local batch = '{"room":' .. cjson.encode(ARGV[1]) .. ',"epoch":' .. cjson.encode(epoch) .. ',"id":' .. id .. ',"messages":[' .. table.concat(items, ',') .. ']}'
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
  private readonly memQueue = new Map<string, object[]>();
  private readonly memSeq = new Map<string, ChatCursor>();
  private readonly maxQueue: number;
  private readonly now: () => number;
  private readonly memHistory = new Map<string, ChatBatch[]>();

  constructor(private readonly options: ChatHubOptions = {}) {
    this.prefix = options.keyPrefix ?? 'gs:';
    this.intervalMs = options.intervalMs ?? 1_000;
    this.historySize = options.historySize ?? 120;
    this.maxPerBatch = options.maxPerBatch ?? 200;
    this.maxQueue = options.maxQueue ?? 2_000;
    this.now = options.now ?? Date.now;
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
  async enqueue(room: string, message: object): Promise<void> {
    const { redis } = this.options;
    if (!redis) {
      const q = this.memQueue.get(room) ?? [];
      q.push(message);
      if (q.length > this.maxQueue) q.splice(0, q.length - this.maxQueue);
      this.memQueue.set(room, q);
      return;
    }
    await redis
      .multi()
      .rpush(this.k('q', room), JSON.stringify(message))
      .ltrim(this.k('q', room), -this.maxQueue, -1)
      .pexpire(this.k('q', room), HISTORY_TTL_MS)
      .sadd(this.k('q:rooms'), room)
      .exec();
  }

  /** Último lote da sala (`id` 0 = nenhum ainda): o ponto de partida de quem entra agora. */
  async latest(room: string): Promise<ChatCursor> {
    const { redis } = this.options;
    if (!redis) return this.memSeq.get(room) ?? { epoch: '0', id: 0 };
    const [seq, epoch] = await redis.mget(this.k('seq', room), this.k('epoch', room));
    return seq && epoch ? { epoch, id: Number(seq) } : { epoch: '0', id: 0 };
  }

  /**
   * Lotes depois do cursor, em ordem. `complete = false` quando não dá para emendar: parte saiu do histórico curto,
   * a época mudou (a sequência recomeçou) ou o cursor está à frente da sala. O cliente relê a sala pelo GET.
   */
  async since(
    room: string,
    after: ChatCursor,
  ): Promise<{ batches: ChatBatch[]; complete: boolean; latest: ChatCursor }> {
    const { redis } = this.options;
    const latest = await this.latest(room);
    if (latest.id === 0) return { batches: [], complete: after.id === 0, latest };
    if (after.epoch !== latest.epoch || after.id > latest.id) {
      // época nova: tudo o que está no histórico é desta época; o cliente relê e segue daqui
      return { batches: [], complete: false, latest };
    }
    let batches: ChatBatch[];
    if (!redis) batches = (this.memHistory.get(room) ?? []).filter((b) => b.id > after.id);
    else {
      const raw = await redis.zrangebyscore(this.k('h', room), `(${after.id}`, '+inf');
      batches = raw.map((r) => JSON.parse(r) as ChatBatch).filter((b) => b.epoch === latest.epoch);
    }
    const complete = after.id >= latest.id || batches[0]?.id === after.id + 1;
    return { batches, complete, latest };
  }

  async start(): Promise<void> {
    const { redis } = this.options;
    if (redis) await this.listenBatches(redis);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  /** Assina o canal dos lotes; falha (Valkey fora no boot) não trava a subida: o ioredis reassina ao reconectar. */
  private async listenBatches(redis: Redis): Promise<void> {
    try {
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
    } catch (err) {
      this.options.logger?.warn({ err }, 'chat: assinatura dos lotes indisponível');
    }
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
        const prev = this.memSeq.get(room);
        const cur = prev ? { epoch: prev.epoch, id: prev.id + 1 } : { epoch: String(this.now()), id: 1 };
        this.memSeq.set(room, cur);
        const batch: ChatBatch = { room, epoch: cur.epoch, id: cur.id, messages };
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
        6,
        this.k('q', room),
        this.k('q:rooms'),
        this.k('seq', room),
        this.k('h', room),
        this.k('batches'),
        this.k('epoch', room),
        room,
        this.maxPerBatch,
        this.historySize,
        HISTORY_TTL_MS,
        this.now(),
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
