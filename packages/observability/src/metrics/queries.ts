import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { quotaBudget, quotaLedger, type Database } from '@galaxie/db';

/**
 * Consultas somente leitura que alimentam as métricas. Tudo é lido do banco a cada coleta (com cache curto),
 * então API e ingestor podem rodar em quantos processos forem sem contar a mesma chamada duas vezes:
 * a fonte da verdade é o ops.quota_ledger, não contadores em memória.
 */

const PROVIDER = 'api-sports';

export interface LedgerCountRow {
  api: string;
  dayUtc: string;
  priority: string;
  outcome: string;
  calls: number;
}

/** Chamadas registradas no ledger desde `sinceDay` (inclusive), por API, dia, prioridade e desfecho. */
export async function ledgerCounts(db: Database, apis: readonly string[], sinceDay: string) {
  const rows = await db
    .select({
      api: quotaLedger.api,
      dayUtc: quotaLedger.dayUtc,
      priority: quotaLedger.priority,
      outcome: quotaLedger.outcome,
      calls: sql<number>`count(*)::int`,
    })
    .from(quotaLedger)
    .where(
      and(
        eq(quotaLedger.provider, PROVIDER),
        inArray(quotaLedger.api, [...apis]),
        gte(quotaLedger.dayUtc, sinceDay),
      ),
    )
    .groupBy(quotaLedger.api, quotaLedger.dayUtc, quotaLedger.priority, quotaLedger.outcome);
  return rows as LedgerCountRow[];
}

export interface ProviderSnapshotRow {
  api: string;
  /** Contador do fornecedor (/status) + chamadas do ledger enviadas depois da leitura — mesma regra do Governor. */
  providerUsed: number;
  providerLimit: number;
  plan: string | null;
}

export async function providerSnapshots(db: Database, dayUtc: string): Promise<ProviderSnapshotRow[]> {
  const rows = await db.execute<{
    api: string;
    provider_used: number;
    provider_limit: number;
    plan: string | null;
  }>(sql`
    select s.api,
           (s.provider_used + (
              select count(*) from ops.quota_ledger l
              where l.provider = s.provider and l.api = s.api and l.day_utc = s.day_utc
                and l.sent_at >= s.captured_at
           ))::int as provider_used,
           s.provider_limit,
           s.plan
    from ops.quota_snapshot s
    where s.provider = ${PROVIDER} and s.day_utc = ${dayUtc}
  `);
  return rows.map((r) => ({
    api: r.api,
    providerUsed: Number(r.provider_used),
    providerLimit: Number(r.provider_limit),
    plan: r.plan,
  }));
}

export interface BudgetRow {
  api: string;
  priority: string;
  planned: number;
}

export async function plannedBudgets(db: Database, dayUtc: string): Promise<BudgetRow[]> {
  return db
    .select({ api: quotaBudget.api, priority: quotaBudget.priority, planned: quotaBudget.planned })
    .from(quotaBudget)
    .where(and(eq(quotaBudget.provider, PROVIDER), eq(quotaBudget.dayUtc, dayUtc)));
}

export interface JobStatsRow {
  job: string;
  /** Execuções nas últimas 24 h por status (running | ok | error). */
  runs24h: Record<string, number>;
  lastStatus: string;
  lastStartedAt: Date;
  lastFinishedAt: Date | null;
  lastSuccessAt: Date | null;
  /** Falhas seguidas desde o último sucesso (ou desde sempre, se nunca houve sucesso). */
  consecutiveFailures: number;
}

export async function jobStats(db: Database): Promise<JobStatsRow[]> {
  const rows = await db.execute<{
    job: string;
    last_status: string;
    last_started_at: string | Date;
    last_finished_at: string | Date | null;
    last_success_at: string | Date | null;
    consecutive_failures: number;
    runs_24h: Record<string, number> | null;
  }>(sql`
    with last_run as (
      select distinct on (job) job, status, started_at, finished_at
      from ops.job_run
      order by job, started_at desc
    ),
    last_ok as (
      select job, max(started_at) as at from ops.job_run where status = 'ok' group by job
    ),
    recent as (
      select job, jsonb_object_agg(status, n) as runs
      from (
        select job, status, count(*)::int as n
        from ops.job_run
        where started_at >= now() - interval '24 hours'
        group by job, status
      ) x
      group by job
    )
    select lr.job,
           lr.status as last_status,
           lr.started_at as last_started_at,
           lr.finished_at as last_finished_at,
           lo.at as last_success_at,
           (select count(*) from ops.job_run f
             where f.job = lr.job and f.status = 'error'
               and f.started_at > coalesce(lo.at, '-infinity'::timestamptz))::int as consecutive_failures,
           r.runs as runs_24h
    from last_run lr
    left join last_ok lo on lo.job = lr.job
    left join recent r on r.job = lr.job
  `);
  return rows.map((r) => ({
    job: r.job,
    runs24h: r.runs_24h ?? {},
    lastStatus: r.last_status,
    lastStartedAt: new Date(r.last_started_at),
    lastFinishedAt: r.last_finished_at ? new Date(r.last_finished_at) : null,
    lastSuccessAt: r.last_success_at ? new Date(r.last_success_at) : null,
    consecutiveFailures: Number(r.consecutive_failures),
  }));
}

export interface FreshnessRow {
  sport: string;
  lastFetchedAt: Date;
}

/**
 * Última resposta gravada no raw por esporte, olhando só a janela recente (`windowHours`):
 * cada subconsulta desce o índice de fetched_at e para no primeiro registro do esporte.
 */
export async function rawFreshness(
  db: Database,
  sports: readonly string[],
  windowHours: number,
): Promise<FreshnessRow[]> {
  const list = sql.join(
    sports.map((s) => sql`(${s})`),
    sql`, `,
  );
  const rows = await db.execute<{ sport: string; last_fetched_at: string | Date | null }>(sql`
    select s.sport,
           (select max(r.fetched_at) from raw.api_response r
             where r.sport = s.sport
               and r.fetched_at >= now() - make_interval(hours => ${windowHours}::int)) as last_fetched_at
    from (values ${list}) as s(sport)
  `);
  return rows
    .filter((r) => r.last_fetched_at != null)
    .map((r) => ({ sport: r.sport, lastFetchedAt: new Date(r.last_fetched_at!) }));
}

export interface LiveRow {
  sport: string;
  events: number;
  /** Maior idade (s) da última atualização válida entre os eventos ao vivo do esporte. */
  maxStalenessSeconds: number;
}

/** Status que significam "a bola está rolando" (ou prestes a rolar) — precisam de atualização periódica. */
export const LIVE_STATUSES = ['starting', 'live', 'break'] as const;

export async function liveEvents(db: Database): Promise<LiveRow[]> {
  const rows = await db.execute<{ sport: string; events: number; max_staleness: number | string | null }>(sql`
    select sport,
           count(*)::int as events,
           extract(epoch from max(now() - coalesce(last_valid_at, updated_at)))::float8 as max_staleness
    from core.event
    where status in ('starting', 'live', 'break')
    group by sport
  `);
  return rows.map((r) => ({
    sport: r.sport,
    events: Number(r.events),
    maxStalenessSeconds: Math.max(0, Number(r.max_staleness ?? 0)),
  }));
}

export interface LiveSchedulerRow {
  sport: string;
  /** Intervalo médio planejado (s); `null` sem janela ou sem orçamento. */
  intervalSeconds: number | null;
  ticksLeft: number;
  liveBudget: number;
  windowMinutes: number;
  activeEvents: number;
  updatedAt: Date;
}

/**
 * Estado publicado pelo processo do ao vivo (Live Scheduler) em `ops.sync_cursor`
 * (endpoint `live:scheduler`, chave `state`): intervalo dinâmico, orçamento e janelas do dia.
 */
export async function liveSchedulerStates(db: Database): Promise<LiveSchedulerRow[]> {
  const rows = await db.execute<{
    sport: string;
    cursor: Record<string, unknown> | null;
    updated_at: string | Date;
  }>(sql`
    select sport, cursor, updated_at
    from ops.sync_cursor
    where endpoint = 'live:scheduler' and key = 'state'
  `);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return rows.map((r) => {
    const c = r.cursor ?? {};
    return {
      sport: r.sport,
      intervalSeconds: typeof c.intervalSeconds === 'number' ? c.intervalSeconds : null,
      ticksLeft: num(c.ticksLeft),
      liveBudget: num(c.liveBudget),
      windowMinutes: num(c.windowMinutes),
      activeEvents: num(c.activeEvents),
      updatedAt: new Date(r.updated_at),
    };
  });
}
