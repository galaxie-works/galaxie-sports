import {
  ENGAGE_MODULES,
  moduleUsageMonthly,
  MODULE_USAGE_METRICS,
  type Database,
  type EngageModule,
  type ModuleUsageMetric,
} from '@galaxie/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

/** Mês UTC (`YYYY-MM`) de um instante. */
export function utcMonth(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}

/** Dias que as chaves do mês ficam no Valkey depois de criadas: o mês inteiro mais a consolidação do último dia. */
const MONTH_TTL_SEC = 40 * 86_400;

/** Um valor medido: tenant × mês × módulo × métrica. */
export interface ModuleUsageReading {
  tenantId: string;
  month: string;
  module: EngageModule;
  metric: ModuleUsageMetric;
  value: number;
}

/**
 * Medição de uso dos módulos de engajamento (#1018). As rotas e o worker do engajamento chamam os métodos de
 * registro; o consolidador lê `read()` e grava em `api.module_usage_monthly`.
 *
 * - `active_fans`: torcedores distintos no mês (HyperLogLog por tenant × módulo × mês).
 * - `peak_connections`: maior número de conexões simultâneas visto no mês.
 * - `clicks`, `credits`: contadores.
 */
export interface ModuleUsageMeter {
  /** Torcedor (id interno do Perfil) ativo no módulo neste mês. */
  fanActive(tenantId: string, module: EngageModule, profileId: string, at?: Date): Promise<void>;
  /** Conexões simultâneas agora; guarda só o maior do mês. */
  connections(tenantId: string, module: EngageModule, current: number, at?: Date): Promise<void>;
  /** Soma a um contador (`clicks` ou `credits`). */
  add(
    tenantId: string,
    module: EngageModule,
    metric: 'clicks' | 'credits',
    n: number,
    at?: Date,
  ): Promise<void>;
  /** Leituras do mês (todos os tenants com uso). */
  read(month: string): Promise<ModuleUsageReading[]>;
  /** Trava curta para que só uma instância consolide por vez. */
  lock(name: string, ttlMs: number): Promise<boolean>;
}

/**
 * No Valkey: `<prefixo>engage:usage:<mês>:<tenant>:<módulo>:active_fans` (HLL) e o hash
 * `<prefixo>engage:usage:<mês>:<tenant>:<módulo>` com `peak_connections`, `clicks` e `credits`; o set
 * `<prefixo>engage:usage:<mês>:keys` lista os pares tenant:módulo com uso.
 */
export class RedisModuleUsageMeter implements ModuleUsageMeter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  private base(month: string, tenantId: string, module: EngageModule) {
    return `${this.prefix}engage:usage:${month}:${tenantId}:${module}`;
  }

  private index(month: string) {
    return `${this.prefix}engage:usage:${month}:keys`;
  }

  private touch(pipe: ReturnType<Redis['pipeline']>, month: string, tenantId: string, module: EngageModule) {
    pipe.sadd(this.index(month), `${tenantId}:${module}`);
    pipe.expire(this.index(month), MONTH_TTL_SEC);
  }

  private async exec(pipe: ReturnType<Redis['pipeline']>) {
    const res = await pipe.exec();
    const failed = res?.find(([err]) => err);
    if (failed) throw failed[0];
  }

  async fanActive(tenantId: string, module: EngageModule, profileId: string, at = new Date()) {
    const month = utcMonth(at);
    const key = `${this.base(month, tenantId, module)}:active_fans`;
    const pipe = this.redis.pipeline();
    pipe.pfadd(key, profileId);
    pipe.expire(key, MONTH_TTL_SEC);
    this.touch(pipe, month, tenantId, module);
    await this.exec(pipe);
  }

  async connections(tenantId: string, module: EngageModule, current: number, at = new Date()) {
    if (!Number.isFinite(current) || current <= 0) return;
    const month = utcMonth(at);
    const key = this.base(month, tenantId, module);
    // maior do mês sem ler antes: HSET só quando o valor atual passa o guardado (atômico no servidor)
    const pipe = this.redis.pipeline();
    pipe.eval(
      `local v = tonumber(redis.call('HGET', KEYS[1], 'peak_connections') or '0')
       if tonumber(ARGV[1]) > v then redis.call('HSET', KEYS[1], 'peak_connections', ARGV[1]) end
       return 1`,
      1,
      key,
      String(Math.floor(current)),
    );
    pipe.expire(key, MONTH_TTL_SEC);
    this.touch(pipe, month, tenantId, module);
    await this.exec(pipe);
  }

  async add(
    tenantId: string,
    module: EngageModule,
    metric: 'clicks' | 'credits',
    n: number,
    at = new Date(),
  ) {
    if (!Number.isFinite(n) || n <= 0) return;
    const month = utcMonth(at);
    const key = this.base(month, tenantId, module);
    const pipe = this.redis.pipeline();
    pipe.hincrby(key, metric, Math.floor(n));
    pipe.expire(key, MONTH_TTL_SEC);
    this.touch(pipe, month, tenantId, module);
    await this.exec(pipe);
  }

  async read(month: string): Promise<ModuleUsageReading[]> {
    const pairs = await this.redis.smembers(this.index(month));
    const out: ModuleUsageReading[] = [];
    for (const pair of pairs) {
      const [tenantId, module] = pair.split(':') as [string, EngageModule];
      if (!tenantId || !(ENGAGE_MODULES as readonly string[]).includes(module)) continue;
      const base = this.base(month, tenantId, module);
      const [hash, fans] = await Promise.all([
        this.redis.hgetall(base),
        this.redis.pfcount(`${base}:active_fans`),
      ]);
      if (fans > 0) out.push({ tenantId, month, module, metric: 'active_fans', value: fans });
      for (const metric of ['peak_connections', 'clicks', 'credits'] as const) {
        const v = Number(hash[metric] ?? 0);
        if (v > 0) out.push({ tenantId, month, module, metric, value: v });
      }
    }
    return out;
  }

  async lock(name: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}lock:${name}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}

/** Em memória (testes e desenvolvimento sem Valkey). `active_fans` conta exato, com Set. */
export class MemoryModuleUsageMeter implements ModuleUsageMeter {
  private readonly fans = new Map<string, Set<string>>();
  private readonly values = new Map<string, number>();

  private k(month: string, tenantId: string, module: EngageModule, metric: ModuleUsageMetric) {
    return [month, tenantId, module, metric].join('\u0000');
  }

  async fanActive(tenantId: string, module: EngageModule, profileId: string, at = new Date()) {
    const key = this.k(utcMonth(at), tenantId, module, 'active_fans');
    const set = this.fans.get(key) ?? new Set<string>();
    set.add(profileId);
    this.fans.set(key, set);
  }

  async connections(tenantId: string, module: EngageModule, current: number, at = new Date()) {
    if (!Number.isFinite(current) || current <= 0) return;
    const key = this.k(utcMonth(at), tenantId, module, 'peak_connections');
    this.values.set(key, Math.max(this.values.get(key) ?? 0, Math.floor(current)));
  }

  async add(
    tenantId: string,
    module: EngageModule,
    metric: 'clicks' | 'credits',
    n: number,
    at = new Date(),
  ) {
    if (!Number.isFinite(n) || n <= 0) return;
    const key = this.k(utcMonth(at), tenantId, module, metric);
    this.values.set(key, (this.values.get(key) ?? 0) + Math.floor(n));
  }

  async read(month: string): Promise<ModuleUsageReading[]> {
    const out: ModuleUsageReading[] = [];
    const split = (key: string) => key.split('\u0000') as [string, string, EngageModule, ModuleUsageMetric];
    for (const [key, set] of this.fans) {
      const [m, tenantId, module, metric] = split(key);
      if (m === month) out.push({ tenantId, month, module, metric, value: set.size });
    }
    for (const [key, value] of this.values) {
      const [m, tenantId, module, metric] = split(key);
      if (m === month) out.push({ tenantId, month, module, metric, value });
    }
    return out;
  }

  async lock(): Promise<boolean> {
    return true;
  }
}

/** `YYYY-MM` → primeiro dia do mês (`YYYY-MM-01`), como fica na coluna `month`. */
export const monthStart = (month: string) => `${month}-01`;

/**
 * Consolida o mês atual e o anterior (a virada do mês ainda pode ter leitura pendente) em
 * `api.module_usage_monthly`. Idempotente: grava o maior entre o consolidado e o lido, então rodar de novo,
 * duas instâncias juntas ou um Valkey zerado no meio do mês nunca reduzem o valor.
 */
export async function persistModuleUsage(
  db: Database,
  meter: ModuleUsageMeter,
  now: Date = new Date(),
): Promise<{ rows: number }> {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const readings = [...(await meter.read(utcMonth(prev))), ...(await meter.read(utcMonth(now)))];
  if (!readings.length) return { rows: 0 };
  // tenant apagado entre a medição e a consolidação: a FK recusaria o lote inteiro
  const tenants = await db.execute<{ id: string }>(
    sql`select id::text from api.tenant where id::text in (${sql.join(
      [...new Set(readings.map((r) => r.tenantId))].map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  const known = new Set(tenants.map((t) => t.id));
  const rows = readings
    .filter((r) => known.has(r.tenantId) && MODULE_USAGE_METRICS[r.metric])
    .map((r) => ({ ...r, month: monthStart(r.month) }));
  if (!rows.length) return { rows: 0 };
  await db
    .insert(moduleUsageMonthly)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        moduleUsageMonthly.tenantId,
        moduleUsageMonthly.month,
        moduleUsageMonthly.module,
        moduleUsageMonthly.metric,
      ],
      set: {
        value: sql`greatest(${moduleUsageMonthly.value}, excluded.value)`,
        updatedAt: sql`now()`,
      },
    });
  return { rows: rows.length };
}

/** Uso por módulo de um tenant num mês (`YYYY-MM`), já consolidado. */
export async function moduleUsageOf(
  db: Database,
  tenantId: string,
  month: string,
): Promise<{ module: EngageModule; metric: ModuleUsageMetric; value: number }[]> {
  return db
    .select({
      module: moduleUsageMonthly.module,
      metric: moduleUsageMonthly.metric,
      value: moduleUsageMonthly.value,
    })
    .from(moduleUsageMonthly)
    .where(and(eq(moduleUsageMonthly.tenantId, tenantId), eq(moduleUsageMonthly.month, monthStart(month))))
    .orderBy(moduleUsageMonthly.module, moduleUsageMonthly.metric);
}

/** Consolidação periódica do uso por módulo (uma instância por vez, pela trava do medidor). */
export class ModuleUsagePersister {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Database,
    private readonly meter: ModuleUsageMeter,
    private readonly options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
  ) {}

  async run(): Promise<{ rows: number } | null> {
    const interval = this.options.intervalMs ?? 5 * 60_000;
    if (!(await this.meter.lock('engage-usage-persist', Math.max(5_000, interval - 1_000)))) return null;
    return persistModuleUsage(this.db, this.meter);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => {
        this.run().catch((err) => this.options.onError?.(err));
      },
      this.options.intervalMs ?? 5 * 60_000,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
