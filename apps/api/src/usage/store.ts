import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { tenant, usageDaily, type Database } from '@galaxie/db';
import { UUID_RE } from '../util.js';
import { USAGE_RETENTION_DAYS, utcDay, type UsageBackend } from './counter.js';

export interface UsageRow {
  tenantId: string;
  day: string;
  route: string;
  requests: number;
}

const DAY_MS = 86_400_000;

/**
 * Dias (UTC) cujos contadores ainda podem estar no Valkey: os `USAGE_RETENTION_DAYS` mais recentes (TTL
 * das chaves), do mais antigo para hoje. Com o Postgres fora por mais de um dia, a consolidação seguinte
 * ainda alcança os dias retidos.
 */
export function liveDays(now: Date = new Date()): string[] {
  return Array.from({ length: USAGE_RETENTION_DAYS }, (_, i) =>
    utcDay(new Date(now.getTime() - (USAGE_RETENTION_DAYS - 1 - i) * DAY_MS)),
  );
}

/**
 * Total de uma rota combinando o consolidado com a contagem da época atual do Valkey (mesma regra do upsert
 * de `persistUsage`): mesma época → base + maior parcela; época nova → soma; sem época (linha ou hash
 * anterior às épocas) → maior valor.
 */
export function combineUsage(
  stored: { requests: number; epoch: string | null; epochRequests: number } | undefined,
  live: { epoch: string | null; n: number },
): number {
  if (!stored) return live.n;
  if (!live.epoch || !stored.epoch) return Math.max(stored.requests, live.n);
  if (stored.epoch === live.epoch)
    return stored.requests - stored.epochRequests + Math.max(stored.epochRequests, live.n);
  return stored.requests + live.n;
}

/**
 * Consolida os contadores do Valkey em `api.usage_daily`. Idempotente por época (`UsageSnapshot.epoch`):
 * dentro da mesma época, a parcela consolidada é trocada pelo maior valor (repetir não soma de novo); uma
 * época nova — o Valkey perdeu o hash (reinício sem dados, AOF truncado) — tem a contagem somada ao
 * consolidado, em vez de o `greatest()` congelar o uso até o contador novo passar o antigo, e sem cobrar
 * em dobro o que já estava consolidado. Linha ou hash sem época (anteriores a esta regra) usam o maior
 * valor, como antes. Perde-se só o que o Valkey contou e ninguém consolidou antes da perda.
 * Tenants inexistentes (ex.: removidos) são ignorados.
 */
export async function persistUsage(
  db: Database,
  backend: UsageBackend,
  days: string[] = liveDays(),
): Promise<{ rows: number }> {
  let rows = 0;
  for (const day of days) {
    const ids = (await backend.tenants(day)).filter((id) => UUID_RE.test(id));
    if (!ids.length) continue;
    const known = new Set(
      (await db.select({ id: tenant.id }).from(tenant).where(inArray(tenant.id, ids))).map((r) => r.id),
    );
    for (const tenantId of known) {
      const { epoch, counts } = await backend.snapshot(day, tenantId);
      const values = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([route, requests]) => ({ tenantId, day, route, requests, epoch, epochRequests: requests }));
      if (!values.length) continue;
      const cur = { requests: usageDaily.requests, epoch: usageDaily.epoch, part: usageDaily.epochRequests };
      await db
        .insert(usageDaily)
        .values(values)
        .onConflictDoUpdate({
          target: [usageDaily.tenantId, usageDaily.day, usageDaily.route],
          set: {
            requests: sql`case
              when excluded.epoch is null or ${cur.epoch} is null then greatest(${cur.requests}, excluded.requests)
              when ${cur.epoch} = excluded.epoch
                then ${cur.requests} - ${cur.part} + greatest(${cur.part}, excluded.epoch_requests)
              else ${cur.requests} + excluded.epoch_requests end`,
            epochRequests: sql`case
              when excluded.epoch is null then ${cur.part}
              when ${cur.epoch} = excluded.epoch then greatest(${cur.part}, excluded.epoch_requests)
              else excluded.epoch_requests end`,
            epoch: sql`coalesce(excluded.epoch, ${cur.epoch})`,
            updatedAt: sql`now()`,
          },
        });
      rows += values.length;
    }
  }
  return { rows };
}

/**
 * Uso no intervalo [from, to] (dias UTC, inclusivos): o consolidado no Postgres combinado com os
 * contadores vivos do Valkey para os dias retidos (`combineUsage`, a mesma regra da consolidação).
 */
export async function queryUsage(
  db: Database,
  backend: UsageBackend | undefined,
  options: { from: string; to: string; tenantId?: string; now?: Date },
): Promise<UsageRow[]> {
  const where = [gte(usageDaily.day, options.from), lte(usageDaily.day, options.to)];
  if (options.tenantId) where.push(eq(usageDaily.tenantId, options.tenantId));
  const stored = await db
    .select({
      tenantId: usageDaily.tenantId,
      day: usageDaily.day,
      route: usageDaily.route,
      requests: usageDaily.requests,
      epoch: usageDaily.epoch,
      epochRequests: usageDaily.epochRequests,
    })
    .from(usageDaily)
    .where(and(...where))
    .orderBy(asc(usageDaily.day), asc(usageDaily.route));

  const keyOf = (r: Omit<UsageRow, 'requests'>) => `${r.tenantId}|${r.day}|${r.route}`;
  const storedBy = new Map(
    stored.map((r) => [
      keyOf(r),
      { requests: Number(r.requests), epoch: r.epoch, epochRequests: Number(r.epochRequests) },
    ]),
  );
  const merged = new Map<string, UsageRow>();
  for (const r of stored)
    merged.set(keyOf(r), { tenantId: r.tenantId, day: r.day, route: r.route, requests: Number(r.requests) });

  if (backend) {
    for (const day of liveDays(options.now)) {
      if (day < options.from || day > options.to) continue;
      const tenants = options.tenantId ? [options.tenantId] : await backend.tenants(day);
      for (const tenantId of tenants) {
        const { epoch, counts } = await backend.snapshot(day, tenantId);
        for (const [route, n] of Object.entries(counts)) {
          const k = keyOf({ tenantId, day, route });
          merged.set(k, { tenantId, day, route, requests: combineUsage(storedBy.get(k), { epoch, n }) });
        }
      }
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.tenantId.localeCompare(b.tenantId) || a.route.localeCompare(b.route),
  );
}

export interface DailyUsage {
  day: string;
  total: number;
  routes: { route: string; requests: number }[];
}

/** Agrupa linhas de um tenant por dia (rotas em ordem decrescente de volume). */
export function usageByDay(rows: UsageRow[]): DailyUsage[] {
  const days = new Map<string, DailyUsage>();
  for (const r of rows) {
    let d = days.get(r.day);
    if (!d) days.set(r.day, (d = { day: r.day, total: 0, routes: [] }));
    d.total += r.requests;
    d.routes.push({ route: r.route, requests: r.requests });
  }
  for (const d of days.values())
    d.routes.sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Persister periódico (uma instância por vez, via trava no backend). */
export class UsagePersister {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Database,
    private readonly backend: UsageBackend,
    private readonly options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
  ) {}

  /** Executa uma consolidação se obtiver a trava; devolve null se outra instância a detém. */
  async run(): Promise<{ rows: number } | null> {
    const interval = this.options.intervalMs ?? 60_000;
    if (!(await this.backend.lock('usage-persist', Math.max(5_000, interval - 1_000)))) return null;
    return persistUsage(this.db, this.backend);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.run().catch((err) => this.options.onError?.(err));
    }, this.options.intervalMs ?? 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
