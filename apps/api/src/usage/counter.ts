import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** Dia UTC no formato YYYY-MM-DD. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Uso de um tenant num dia: rota → requisições. */
export type RouteCounts = Record<string, number>;

/** Dias que os contadores ficam no Valkey (TTL das chaves); o persister reconsidera todos eles. */
export const USAGE_RETENTION_DAYS = 4;

/**
 * Campo do hash do dia com a **época** do contador, gravado (HSETNX) antes do primeiro HINCRBY do hash.
 * Hash recriado (Valkey reiniciado sem dados, chave apagada, sufixo do AOF perdido) = época nova, e o
 * Postgres soma a contagem da época nova ao consolidado em vez de comparar com `greatest()` (ver
 * `persistUsage`). Não é rota (rotas são `MÉTODO /caminho`); `get()` nunca o devolve.
 *
 * Fica no próprio hash (não numa chave à parte) para sumir junto com os contadores em qualquer perda,
 * inclusive por despejo de memória. Efeito colateral num rollback para uma versão sem épocas: o `get()`
 * antigo lê `#epoca` como uma rota de valor NaN — a consolidação antiga o descarta (`n > 0`), mas a
 * consulta de uso antiga mostra total null para os dias ainda no Valkey (até 4 dias).
 */
const EPOCH_FIELD = '#epoca';

/** Época ordenada no tempo (`<ms em largura fixa de 15>-<aleatório>`): a consolidação ignora snapshot mais velho. */
const newEpoch = () => `${String(Date.now()).padStart(15, '0')}-${randomBytes(6).toString('base64url')}`;

const splitEpoch = (raw: Record<string, string>): UsageSnapshot => {
  let epoch: string | null = null;
  const counts: RouteCounts = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === EPOCH_FIELD) epoch = v;
    else counts[k] = Number(v);
  }
  return { epoch, counts };
};

/** Contadores de tenant × dia e a época do hash (null = hash anterior às épocas). */
export interface UsageSnapshot {
  epoch: string | null;
  counts: RouteCounts;
}

/**
 * Onde os contadores diários vivem. No Valkey: um hash por tenant × dia
 * (`<prefixo>usage:<dia>:<tenant>` → campo = rota, HINCRBY) e um set com os tenants ativos no dia
 * (`<prefixo>usage:<dia>:tenants`). As chaves expiram em `ttlDays` — antes disso o persister
 * consolida os totais em `api.usage_daily`.
 */
export interface UsageBackend {
  incr(entries: { day: string; tenantId: string; route: string; n: number }[]): Promise<void>;
  tenants(day: string): Promise<string[]>;
  get(day: string, tenantId: string): Promise<RouteCounts>;
  /** Contadores com a época do hash (consolidação e consulta). */
  snapshot(day: string, tenantId: string): Promise<UsageSnapshot>;
  /** Trava curta para que só uma instância consolide por vez (true = obteve a trava). */
  lock(name: string, ttlMs: number): Promise<boolean>;
}

export class RedisUsageBackend implements UsageBackend {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
    private readonly ttlDays = USAGE_RETENTION_DAYS,
  ) {}

  private hashKey(day: string, tenantId: string) {
    return `${this.prefix}usage:${day}:${tenantId}`;
  }

  private setKey(day: string) {
    return `${this.prefix}usage:${day}:tenants`;
  }

  async incr(entries: { day: string; tenantId: string; route: string; n: number }[]): Promise<void> {
    if (!entries.length) return;
    const ttl = this.ttlDays * 86_400;
    const pipe = this.redis.pipeline();
    const touched = new Set<string>();
    for (const e of entries) {
      const key = this.hashKey(e.day, e.tenantId);
      // época antes do primeiro HINCRBY: num AOF truncado, perder a época implica perder os incrementos
      // seguintes (o AOF perde um sufixo), então nunca sobra contagem de época nova sem a época
      if (!touched.has(key)) pipe.hsetnx(key, EPOCH_FIELD, newEpoch());
      pipe.hincrby(key, e.route, e.n);
      if (!touched.has(key)) {
        touched.add(key);
        pipe.expire(key, ttl);
        pipe.sadd(this.setKey(e.day), e.tenantId);
        pipe.expire(this.setKey(e.day), ttl);
      }
    }
    const res = await pipe.exec();
    const failed = res?.find(([err]) => err);
    if (failed) throw failed[0];
  }

  async tenants(day: string): Promise<string[]> {
    return this.redis.smembers(this.setKey(day));
  }

  async get(day: string, tenantId: string): Promise<RouteCounts> {
    return (await this.snapshot(day, tenantId)).counts;
  }

  async snapshot(day: string, tenantId: string): Promise<UsageSnapshot> {
    return splitEpoch(await this.redis.hgetall(this.hashKey(day, tenantId)));
  }

  async lock(name: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}lock:${name}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}

/** Em memória (testes e desenvolvimento sem Valkey; não compartilha entre instâncias). */
export class MemoryUsageBackend implements UsageBackend {
  readonly data = new Map<string, Map<string, RouteCounts>>();
  private readonly epochs = new Map<string, string>();

  async incr(entries: { day: string; tenantId: string; route: string; n: number }[]): Promise<void> {
    for (const e of entries) {
      let day = this.data.get(e.day);
      if (!day) this.data.set(e.day, (day = new Map()));
      const counts = day.get(e.tenantId) ?? {};
      counts[e.route] = (counts[e.route] ?? 0) + e.n;
      day.set(e.tenantId, counts);
      const k = `${e.day}\u0000${e.tenantId}`;
      if (!this.epochs.has(k)) this.epochs.set(k, newEpoch());
    }
  }

  async tenants(day: string): Promise<string[]> {
    return [...(this.data.get(day)?.keys() ?? [])];
  }

  async get(day: string, tenantId: string): Promise<RouteCounts> {
    return { ...(this.data.get(day)?.get(tenantId) ?? {}) };
  }

  async snapshot(day: string, tenantId: string): Promise<UsageSnapshot> {
    return {
      epoch: this.epochs.get(`${day}\u0000${tenantId}`) ?? null,
      counts: await this.get(day, tenantId),
    };
  }

  /** Simula um Valkey reiniciado sem persistência (testes): a próxima contagem abre uma época nova. */
  reset(): void {
    this.data.clear();
    this.epochs.clear();
  }

  async lock(): Promise<boolean> {
    return true;
  }
}

export interface UsageCounterOptions {
  /** Intervalo de envio do buffer ao backend (ms). Padrão 1 s. */
  flushIntervalMs?: number;
  now?: () => Date;
  onError?: (err: unknown) => void;
}

/**
 * Contador de uso barato: `record()` só incrementa um Map em memória (sem I/O na requisição);
 * a cada `flushIntervalMs` o buffer agregado vira um único pipeline de HINCRBY no Valkey.
 * A 10k req/s isso dá ~1 round-trip por segundo por instância, em vez de 10k.
 * Em caso de queda abrupta perde-se no máximo o último intervalo.
 */
export class UsageCounter {
  private buffer = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => Date;

  constructor(
    readonly backend: UsageBackend,
    private readonly options: UsageCounterOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  record(tenantId: string, route: string): void {
    const k = `${utcDay(this.now())}\u0000${tenantId}\u0000${route}`;
    this.buffer.set(k, (this.buffer.get(k) ?? 0) + 1);
  }

  /** Envia o buffer ao backend; em erro, devolve as contagens ao buffer. */
  async flush(): Promise<void> {
    if (!this.buffer.size) return;
    const pending = this.buffer;
    this.buffer = new Map();
    const entries = [...pending].map(([k, n]) => {
      const [day, tenantId, route] = k.split('\u0000') as [string, string, string];
      return { day, tenantId, route, n };
    });
    try {
      await this.backend.incr(entries);
    } catch (err) {
      for (const [k, n] of pending) this.buffer.set(k, (this.buffer.get(k) ?? 0) + n);
      // evita crescer sem limite se o Valkey ficar fora por muito tempo
      if (this.buffer.size > 100_000) this.buffer.clear();
      throw err;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((err) => this.options.onError?.(err));
    }, this.options.flushIntervalMs ?? 1000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush().catch((err) => this.options.onError?.(err));
  }
}
