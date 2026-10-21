import type { Redis } from 'ioredis';

/** Dia UTC no formato YYYY-MM-DD. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Uso de um tenant num dia: rota → requisições. */
export type RouteCounts = Record<string, number>;

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
  /** Trava curta para que só uma instância consolide por vez (true = obteve a trava). */
  lock(name: string, ttlMs: number): Promise<boolean>;
}

export class RedisUsageBackend implements UsageBackend {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
    private readonly ttlDays = 4,
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
    const raw = await this.redis.hgetall(this.hashKey(day, tenantId));
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
  }

  async lock(name: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}lock:${name}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}

/** Em memória (testes e desenvolvimento sem Valkey; não compartilha entre instâncias). */
export class MemoryUsageBackend implements UsageBackend {
  readonly data = new Map<string, Map<string, RouteCounts>>();

  async incr(entries: { day: string; tenantId: string; route: string; n: number }[]): Promise<void> {
    for (const e of entries) {
      let day = this.data.get(e.day);
      if (!day) this.data.set(e.day, (day = new Map()));
      const counts = day.get(e.tenantId) ?? {};
      counts[e.route] = (counts[e.route] ?? 0) + e.n;
      day.set(e.tenantId, counts);
    }
  }

  async tenants(day: string): Promise<string[]> {
    return [...(this.data.get(day)?.keys() ?? [])];
  }

  async get(day: string, tenantId: string): Promise<RouteCounts> {
    return { ...(this.data.get(day)?.get(tenantId) ?? {}) };
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
