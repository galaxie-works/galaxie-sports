import {
  API_MODULES,
  COUNT_USAGE_METRICS,
  DISTINCT_USAGE_METRICS,
  moduleUsageMonthly,
  MODULE_USAGE_METRICS,
  type ApiModule,
  type CountUsageMetric,
  type Database,
  type DistinctUsageMetric,
  type ModuleUsageMetric,
} from '@galaxie/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { newEpoch } from '../usage/counter.js';

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
  module: ApiModule;
  metric: ModuleUsageMetric;
  value: number;
  /**
   * Época da chave que guardou o valor, criada na primeira escrita dela (null = sem época). Chave recriada
   * (Valkey reiniciado sem dados, chave apagada) = época nova, e a consolidação soma em vez de comparar.
   */
  epoch: string | null;
}

/** Campo do hash com a época (o mesmo nome dos contadores diários; não é métrica). */
const EPOCH_FIELD = '#epoca';

/**
 * Medição de uso por módulo (#1018; módulos de dados desde a F6 da plataforma comercial, #1138). As rotas e o worker do engajamento chamam os métodos de
 * registro; o consolidador lê `read()` e grava em `api.module_usage_monthly`.
 *
 * - `active_fans`: torcedores distintos no mês (HyperLogLog por tenant × módulo × mês).
 * - `peak_connections`: maior número de conexões simultâneas visto no mês.
 * - `clicks`, `credits`: contadores.
 */
export interface ModuleUsageMeter {
  /** Torcedor (id interno do Perfil) ativo no módulo neste mês. */
  fanActive(tenantId: string, module: ApiModule, profileId: string, at?: Date): Promise<void>;
  /** Membro distinto de uma métrica de distintos (`active_fans`, `active_markets`) neste mês. */
  distinct(
    tenantId: string,
    module: ApiModule,
    metric: DistinctUsageMetric,
    member: string,
    at?: Date,
  ): Promise<void>;
  /** Conexões simultâneas agora; guarda só o maior do mês. */
  connections(tenantId: string, module: ApiModule, current: number, at?: Date): Promise<void>;
  /** Soma a um contador (`clicks`, `credits`, `widget_views`, `enriched_games`). */
  add(tenantId: string, module: ApiModule, metric: CountUsageMetric, n: number, at?: Date): Promise<void>;
  /** Leituras do mês (todos os tenants com uso). */
  read(month: string): Promise<ModuleUsageReading[]>;
  /** Trava curta para que só uma instância consolide por vez. */
  lock(name: string, ttlMs: number): Promise<boolean>;
}

/**
 * No Valkey: `<prefixo>engage:usage:<mês>:<tenant>:<módulo>:active_fans` (HLL, com a época em
 * `…:active_fans:epoch`) e o hash `<prefixo>engage:usage:<mês>:<tenant>:<módulo>` com `peak_connections`,
 * `clicks`, `credits` e a época em `#epoca`; o set `<prefixo>engage:usage:<mês>:keys` lista os pares
 * tenant:módulo com uso. A época é gravada só se ainda não existe (HSETNX / SET NX), antes do valor.
 */
export class RedisModuleUsageMeter implements ModuleUsageMeter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  private base(month: string, tenantId: string, module: ApiModule) {
    return `${this.prefix}engage:usage:${month}:${tenantId}:${module}`;
  }

  private index(month: string) {
    return `${this.prefix}engage:usage:${month}:keys`;
  }

  private touch(pipe: ReturnType<Redis['pipeline']>, month: string, tenantId: string, module: ApiModule) {
    pipe.sadd(this.index(month), `${tenantId}:${module}`);
    pipe.expire(this.index(month), MONTH_TTL_SEC);
  }

  private async exec(pipe: ReturnType<Redis['pipeline']>) {
    const res = await pipe.exec();
    const failed = res?.find(([err]) => err);
    if (failed) throw failed[0];
  }

  async fanActive(tenantId: string, module: ApiModule, profileId: string, at = new Date()) {
    await this.distinct(tenantId, module, 'active_fans', profileId, at);
  }

  async distinct(
    tenantId: string,
    module: ApiModule,
    metric: DistinctUsageMetric,
    member: string,
    at = new Date(),
  ) {
    const month = utcMonth(at);
    const key = `${this.base(month, tenantId, module)}:${metric}`;
    const pipe = this.redis.pipeline();
    pipe.set(`${key}:epoch`, newEpoch(), 'EX', MONTH_TTL_SEC, 'NX');
    pipe.pfadd(key, member);
    pipe.expire(key, MONTH_TTL_SEC);
    pipe.expire(`${key}:epoch`, MONTH_TTL_SEC);
    this.touch(pipe, month, tenantId, module);
    await this.exec(pipe);
  }

  async connections(tenantId: string, module: ApiModule, current: number, at = new Date()) {
    if (!Number.isFinite(current) || current <= 0) return;
    const month = utcMonth(at);
    const key = this.base(month, tenantId, module);
    // maior do mês sem ler antes: HSET só quando o valor atual passa o guardado (atômico no servidor)
    const pipe = this.redis.pipeline();
    pipe.hsetnx(key, EPOCH_FIELD, newEpoch());
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

  async add(tenantId: string, module: ApiModule, metric: CountUsageMetric, n: number, at = new Date()) {
    if (!Number.isFinite(n) || n <= 0) return;
    const month = utcMonth(at);
    const key = this.base(month, tenantId, module);
    const pipe = this.redis.pipeline();
    pipe.hsetnx(key, EPOCH_FIELD, newEpoch());
    pipe.hincrby(key, metric, Math.floor(n));
    pipe.expire(key, MONTH_TTL_SEC);
    this.touch(pipe, month, tenantId, module);
    await this.exec(pipe);
  }

  async read(month: string): Promise<ModuleUsageReading[]> {
    const pairs = await this.redis.smembers(this.index(month));
    const out: ModuleUsageReading[] = [];
    for (const pair of pairs) {
      const [tenantId, module] = pair.split(':') as [string, ApiModule];
      if (!tenantId || !(API_MODULES as readonly string[]).includes(module)) continue;
      const base = this.base(month, tenantId, module);
      const [hash, ...distinct] = await Promise.all([
        this.redis.hgetall(base),
        ...DISTINCT_USAGE_METRICS.map(async (metric) => ({
          metric,
          value: await this.redis.pfcount(`${base}:${metric}`),
          epoch: await this.redis.get(`${base}:${metric}:epoch`),
        })),
      ]);
      for (const d of distinct)
        if (d.value > 0)
          out.push({ tenantId, month, module, metric: d.metric, value: d.value, epoch: d.epoch });
      for (const metric of ['peak_connections', ...COUNT_USAGE_METRICS] as const) {
        const v = Number(hash[metric] ?? 0);
        if (v > 0) out.push({ tenantId, month, module, metric, value: v, epoch: hash[EPOCH_FIELD] ?? null });
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
  /** Época por chave, criada na primeira escrita (`reset()` simula o Valkey zerado). */
  private readonly epochs = new Map<string, string>();

  private epochOf(key: string): string {
    let e = this.epochs.get(key);
    if (!e) {
      e = newEpoch();
      this.epochs.set(key, e);
    }
    return e;
  }

  /** Esquece tudo, como um Valkey reiniciado sem dados (testes). */
  reset(): void {
    this.fans.clear();
    this.values.clear();
    this.epochs.clear();
  }

  private k(month: string, tenantId: string, module: ApiModule, metric: ModuleUsageMetric) {
    return [month, tenantId, module, metric].join('\u0000');
  }

  async fanActive(tenantId: string, module: ApiModule, profileId: string, at = new Date()) {
    await this.distinct(tenantId, module, 'active_fans', profileId, at);
  }

  async distinct(
    tenantId: string,
    module: ApiModule,
    metric: DistinctUsageMetric,
    member: string,
    at = new Date(),
  ) {
    const key = this.k(utcMonth(at), tenantId, module, metric);
    this.epochOf(key);
    const set = this.fans.get(key) ?? new Set<string>();
    set.add(member);
    this.fans.set(key, set);
  }

  async connections(tenantId: string, module: ApiModule, current: number, at = new Date()) {
    if (!Number.isFinite(current) || current <= 0) return;
    const key = this.k(utcMonth(at), tenantId, module, 'peak_connections');
    this.epochOf(key);
    this.values.set(key, Math.max(this.values.get(key) ?? 0, Math.floor(current)));
  }

  async add(tenantId: string, module: ApiModule, metric: CountUsageMetric, n: number, at = new Date()) {
    if (!Number.isFinite(n) || n <= 0) return;
    const key = this.k(utcMonth(at), tenantId, module, metric);
    this.epochOf(key);
    this.values.set(key, (this.values.get(key) ?? 0) + Math.floor(n));
  }

  async read(month: string): Promise<ModuleUsageReading[]> {
    const out: ModuleUsageReading[] = [];
    const split = (key: string) => key.split('\u0000') as [string, string, ApiModule, ModuleUsageMetric];
    for (const [key, set] of this.fans) {
      const [m, tenantId, module, metric] = split(key);
      if (m === month)
        out.push({ tenantId, month, module, metric, value: set.size, epoch: this.epochs.get(key) ?? null });
    }
    for (const [key, value] of this.values) {
      const [m, tenantId, module, metric] = split(key);
      if (m === month)
        out.push({ tenantId, month, module, metric, value, epoch: this.epochs.get(key) ?? null });
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
 * `api.module_usage_monthly`, por época, com a mesma regra de `persistUsage`:
 * - mesma época: `value = greatest(value, epoch_base + lido)`; idempotente, então rodar de novo ou duas
 *   instâncias juntas nunca contam em dobro;
 * - época mais nova (o Valkey perdeu a chave no meio do mês): `epoch_base := value` e o lido soma, em vez de
 *   o `greatest()` congelar o uso até o contador novo passar o antigo. Em `active_fans`, um torcedor visto
 *   antes e depois da perda conta duas vezes: o HLL antigo não existe mais para unir;
 * - época mais velha que a gravada (leitura feita antes de uma perda): ignorada;
 * - `peak_connections` é um máximo e `active_markets` (países, base de excedente da faixa) também fica no `greatest()`
 *   em qualquer época: perder a chave subestima por alguns minutos em vez de contar um país duas vezes e cobrar a mais.
 * O valor consolidado nunca cai. Perde-se só o que o Valkey mediu e ninguém consolidou antes da perda.
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
    .map((r) => ({ ...r, month: monthStart(r.month), epochBase: 0 }));
  if (!rows.length) return { rows: 0 };
  const cur = {
    value: moduleUsageMonthly.value,
    epoch: moduleUsageMonthly.epoch,
    base: moduleUsageMonthly.epochBase,
  };
  // épocas comparadas byte a byte (o prefixo é o instante em largura fixa)
  const newer = sql`excluded.epoch collate "C" > ${cur.epoch} collate "C"`;
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
        value: sql`case
          when excluded.metric in ('peak_connections', 'active_markets') or excluded.epoch is null or ${cur.epoch} is null
            then greatest(${cur.value}, excluded.value)
          when excluded.epoch = ${cur.epoch} then greatest(${cur.value}, ${cur.base} + excluded.value)
          when ${newer} then ${cur.value} + excluded.value
          else ${cur.value} end`,
        epochBase: sql`case
          when excluded.metric in ('peak_connections', 'active_markets') or excluded.epoch is null then ${cur.base}
          when ${cur.epoch} is null then greatest(${cur.value}, excluded.value) - excluded.value
          when excluded.epoch = ${cur.epoch} then ${cur.base}
          when ${newer} then ${cur.value}
          else ${cur.base} end`,
        epoch: sql`case
          when excluded.epoch is null then ${cur.epoch}
          when ${cur.epoch} is null or ${newer} then excluded.epoch
          else ${cur.epoch} end`,
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
): Promise<{ module: ApiModule; metric: ModuleUsageMetric; value: number }[]> {
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
