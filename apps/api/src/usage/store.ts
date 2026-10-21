import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { tenant, usageDaily, type Database } from '@galaxie/db';
import { UUID_RE } from '../util.js';
import { utcDay, type UsageBackend } from './counter.js';

export interface UsageRow {
  tenantId: string;
  day: string;
  route: string;
  requests: number;
}

const DAY_MS = 86_400_000;

/** Dias (UTC) cujos contadores ainda podem estar só no Valkey: ontem e hoje. */
export function liveDays(now: Date = new Date()): string[] {
  return [utcDay(new Date(now.getTime() - DAY_MS)), utcDay(now)];
}

/**
 * Consolida os contadores do Valkey em `api.usage_daily`. Idempotente: o Valkey guarda o total
 * acumulado do dia, e o upsert mantém o maior valor (um Valkey reiniciado sem AOF não apaga uso já
 * consolidado). Tenants inexistentes (ex.: removidos) são ignorados.
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
      const counts = await backend.get(day, tenantId);
      const values = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([route, requests]) => ({ tenantId, day, route, requests }));
      if (!values.length) continue;
      await db
        .insert(usageDaily)
        .values(values)
        .onConflictDoUpdate({
          target: [usageDaily.tenantId, usageDaily.day, usageDaily.route],
          set: {
            requests: sql`greatest(${usageDaily.requests}, excluded.requests)`,
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
 * contadores vivos do Valkey para ontem/hoje (vale o maior valor por tenant × dia × rota).
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
    })
    .from(usageDaily)
    .where(and(...where))
    .orderBy(asc(usageDaily.day), asc(usageDaily.route));

  const merged = new Map<string, UsageRow>();
  const keyOf = (r: Omit<UsageRow, 'requests'>) => `${r.tenantId}|${r.day}|${r.route}`;
  for (const r of stored) merged.set(keyOf(r), { ...r, requests: Number(r.requests) });

  if (backend) {
    for (const day of liveDays(options.now)) {
      if (day < options.from || day > options.to) continue;
      const tenants = options.tenantId ? [options.tenantId] : await backend.tenants(day);
      for (const tenantId of tenants) {
        for (const [route, n] of Object.entries(await backend.get(day, tenantId))) {
          const k = keyOf({ tenantId, day, route });
          const prev = merged.get(k);
          if (!prev || prev.requests < n) merged.set(k, { tenantId, day, route, requests: n });
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
