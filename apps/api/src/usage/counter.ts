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
 * Campo do hash do dia que marca "já conciliado com o consolidado do Postgres". Não é rota (rotas são
 * `MÉTODO /caminho`); `get()` nunca o devolve.
 */
const RECONCILED_FIELD = '#conciliado';

/**
 * Conciliação atômica (Lua) na primeira consolidação do hash: se algum contador está **abaixo** do
 * consolidado, o Valkey perdeu dados (reinício sem AOF, chave apagada) e o hash recebe o consolidado
 * somado (HINCRBY) ao que foi contado depois; senão só marca. Contadores só crescem, então "abaixo"
 * só acontece com perda.
 * KEYS[1] = hash; ARGV[1] = campo-marca; ARGV[2] = TTL (s); ARGV[3..] = rota, total consolidado.
 */
const RECONCILE_LUA = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  local lost = false
  for i = 3, #ARGV, 2 do
    if tonumber(redis.call('HGET', KEYS[1], ARGV[i]) or '0') < tonumber(ARGV[i + 1]) then
      lost = true
      break
    end
  end
  if lost then
    for i = 3, #ARGV, 2 do redis.call('HINCRBY', KEYS[1], ARGV[i], ARGV[i + 1]) end
  end
  redis.call('HSET', KEYS[1], ARGV[1], lost and '2' or '1')
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return redis.call('HGETALL', KEYS[1])`;

/** Algum contador abaixo do consolidado = o backend perdeu contagens. */
const lostCounts = (live: RouteCounts, stored: RouteCounts) =>
  Object.entries(stored).some(([route, n]) => (live[route] ?? 0) < n);

const withoutMarker = (raw: Record<string, string>): RouteCounts =>
  Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => k !== RECONCILED_FIELD)
      .map(([k, v]) => [k, Number(v)]),
  );

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
  /**
   * Na primeira consolidação de tenant × dia neste backend, concilia com o consolidado do Postgres
   * (`stored`): se o backend perdeu contagens (ex.: Valkey reiniciado), soma o consolidado ao que foi
   * contado depois — sem isso o `greatest()` congelaria o uso até o contador novo passar o antigo.
   * Devolve os contadores já conciliados.
   */
  reconcile(day: string, tenantId: string, stored: RouteCounts): Promise<RouteCounts>;
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
    return withoutMarker(await this.redis.hgetall(this.hashKey(day, tenantId)));
  }

  async reconcile(day: string, tenantId: string, stored: RouteCounts): Promise<RouteCounts> {
    const args = Object.entries(stored).flatMap(([route, n]) => [route, String(n)]);
    const flat = (await this.redis.eval(
      RECONCILE_LUA,
      1,
      this.hashKey(day, tenantId),
      RECONCILED_FIELD,
      String(this.ttlDays * 86_400),
      ...args,
    )) as string[];
    const raw: Record<string, string> = {};
    for (let i = 0; i + 1 < flat.length; i += 2) raw[flat[i]!] = flat[i + 1]!;
    return withoutMarker(raw);
  }

  async lock(name: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}lock:${name}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}

/** Em memória (testes e desenvolvimento sem Valkey; não compartilha entre instâncias). */
export class MemoryUsageBackend implements UsageBackend {
  readonly data = new Map<string, Map<string, RouteCounts>>();
  private readonly reconciled = new Set<string>();

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

  async reconcile(day: string, tenantId: string, stored: RouteCounts): Promise<RouteCounts> {
    const k = `${day}\u0000${tenantId}`;
    if (!this.reconciled.has(k)) {
      this.reconciled.add(k);
      if (lostCounts(await this.get(day, tenantId), stored))
        await this.incr(Object.entries(stored).map(([route, n]) => ({ day, tenantId, route, n })));
    }
    return this.get(day, tenantId);
  }

  /** Simula um Valkey reiniciado sem persistência (testes). */
  reset(): void {
    this.data.clear();
    this.reconciled.clear();
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
