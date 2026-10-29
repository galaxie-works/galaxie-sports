import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { quotaBudget, quotaLedger, readRuntimeOverrides, type Database } from '@galaxie/db';
import { AI_CREDIT_CHECK } from '@galaxie/runtime-config';

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
  /** Primeira execução registrada: idade de um job que nunca teve sucesso (ex.: ensaio de restauração parado). */
  firstStartedAt: Date;
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
    first_started_at: string | Date;
    consecutive_failures: number;
    runs_24h: Record<string, number> | null;
  }>(sql`
    with last_run as (
      select distinct on (job) job, status, started_at, finished_at
      from ops.job_run
      order by job, started_at desc
    ),
    last_ok as (
      -- budget_skipped: o job gravou o determinístico porque o orçamento de IA recusou; conta como sucesso
      select job, max(started_at) as at from ops.job_run
       where status in ('ok', 'budget_skipped') group by job
    ),
    first_run as (
      select job, min(started_at) as at from ops.job_run group by job
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
           fr.at as first_started_at,
           (select count(*) from ops.job_run f
             where f.job = lr.job and f.status = 'error'
               and f.started_at > coalesce(lo.at, '-infinity'::timestamptz))::int as consecutive_failures,
           r.runs as runs_24h
    from last_run lr
    left join last_ok lo on lo.job = lr.job
    join first_run fr on fr.job = lr.job
    left join recent r on r.job = lr.job
  `);
  return rows.map((r) => ({
    job: r.job,
    runs24h: r.runs_24h ?? {},
    lastStatus: r.last_status,
    lastStartedAt: new Date(r.last_started_at),
    lastFinishedAt: r.last_finished_at ? new Date(r.last_finished_at) : null,
    lastSuccessAt: r.last_success_at ? new Date(r.last_success_at) : null,
    firstStartedAt: new Date(r.first_started_at),
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

/**
 * Quem deveria atualizar o jogo em andamento: `poller` = está no plano publicado pelo processo do ao vivo
 * (`includedEventIds` em ops.sync_cursor); `clock` = só o relógio dos eventos o moveu pelo horário (fora do
 * catálogo, abaixo de LIVE_MIN_PRIORITY ou esporte sem ao vivo), e a fonte só confirma depois (reconciliação
 * ou agenda D-1 do sync diário).
 */
export type LiveCoverage = 'poller' | 'clock';

export interface LiveRow {
  sport: string;
  coverage: LiveCoverage;
  events: number;
  /**
   * Maior idade (s) da última atualização válida entre os eventos ao vivo do esporte, contada no máximo desde
   * o apito: antes dele a última observação é a agenda do sync, e o `live` da fonte ainda não traz o jogo.
   */
  maxStalenessSeconds: number;
}

/** Status que significam "a bola está rolando" (ou prestes a rolar) — precisam de atualização periódica. */
export const LIVE_STATUSES = ['starting', 'live', 'break'] as const;

export async function liveEvents(db: Database): Promise<LiveRow[]> {
  const rows = await db.execute<{
    sport: string;
    coverage: LiveCoverage;
    events: number;
    max_staleness: number | string | null;
  }>(sql`
    with covered as (
      select distinct c.sport, ids.id
      from ops.sync_cursor c
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(c.cursor->'includedEventIds') = 'array' then c.cursor->'includedEventIds'
             else '[]'::jsonb end
      ) as ids(id)
      where c.endpoint = 'live:scheduler' and c.key = 'state'
    )
    select e.sport,
           case when cv.id is null then 'clock' else 'poller' end as coverage,
           count(*)::int as events,
           extract(epoch from max(now() - greatest(coalesce(e.last_valid_at, e.updated_at), e.starts_at)))::float8
             as max_staleness
    from core.event e
    left join covered cv on cv.sport = e.sport and cv.id = e.id::text
    where e.status in ('starting', 'live', 'break')
    group by 1, 2
  `);
  return rows.map((r) => ({
    sport: r.sport,
    coverage: r.coverage,
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

export interface ChangeFeedConsumerRow {
  /**
   * `demo-cache:<nome>` (demo_auth.cache_feed_cursor), `webhooks:<nome>` (api.webhook_cursor) ou `api:<nome>`
   * (api.change_feed_cursor: o purge do cache da API, `api:cache-purge`).
   */
  consumer: string;
  /** Mudanças depois do cursor (contadas até 10 000). */
  pending: number;
  /** Idade (s) da mudança pendente mais antiga; 0 sem pendência. */
  oldestPendingAgeSeconds: number;
}

/**
 * Consumidores do `ops.change_feed` com cursor salvo no banco: quanto falta e há quanto tempo a mais antiga
 * espera. O cursor da demo é criado pela própria demo na primeira leitura (a tabela pode não existir).
 */
export async function changeFeedConsumers(db: Database): Promise<ChangeFeedConsumerRow[]> {
  const [reg] = await db.execute<{ demo: boolean }>(
    sql`select to_regclass('demo_auth.cache_feed_cursor') is not null as demo`,
  );
  const sources = [
    sql`select 'webhooks:' || name as consumer, last_change_id from api.webhook_cursor`,
    sql`select 'api:' || name, last_change_id from api.change_feed_cursor`,
  ];
  if (reg?.demo)
    sources.push(sql`select 'demo-cache:' || name, last_change_id from demo_auth.cache_feed_cursor`);
  const rows = await db.execute<{ consumer: string; pending: number; age: number | string | null }>(sql`
    with c as (${sql.join(sources, sql` union all `)})
    select c.consumer,
           (select count(*) from (select 1 from ops.change_feed f where f.id > c.last_change_id limit 10000) p)::int
             as pending,
           extract(epoch from now() - (select f.created_at from ops.change_feed f
                                        where f.id > c.last_change_id order by f.id limit 1))::float8 as age
    from c
  `);
  return rows.map((r) => ({
    consumer: r.consumer,
    pending: Number(r.pending),
    oldestPendingAgeSeconds: Math.max(0, Number(r.age ?? 0)),
  }));
}

export interface OpsStateRow {
  /** Sobrescritas do painel (ops.runtime_setting). */
  overrides: Map<string, string>;
  /** Env relatado por cada serviço (ops.runtime_env). */
  reported: { service: string; key: string; value: string | null }[];
  /** Último relato de cada serviço (sinal de vida do scheduler: a cada releitura, 30 s). */
  lastReport: { service: string; at: Date }[];
  /** Última checagem do crédito da conta de IA (scheduler dos agentes). */
  aiCredit: { status: string; provider: string | null; checkedAt: Date } | null;
}

/** Configuração efetiva, sinais de vida dos serviços e a checagem do crédito da IA. */
export async function opsState(db: Database): Promise<OpsStateRow> {
  const [overrides, reported, credit] = await Promise.all([
    readRuntimeOverrides(db),
    db.execute<{ service: string; key: string; value: string | null; reported_at: string | Date }>(
      sql`select service, key, value, reported_at from ops.runtime_env`,
    ),
    db.execute<{ status: string; detail: string | null; checked_at: string | Date }>(sql`
      select status, detail, checked_at from ops.runtime_check
       where name = ${AI_CREDIT_CHECK} order by checked_at desc limit 1`),
  ]);
  const last = new Map<string, Date>();
  for (const r of reported) {
    const at = new Date(r.reported_at);
    if (!last.has(r.service) || at > last.get(r.service)!) last.set(r.service, at);
  }
  const c = credit[0];
  const provider = (() => {
    try {
      return c?.detail ? ((JSON.parse(c.detail) as { provider?: string }).provider ?? null) : null;
    } catch {
      return null; // detalhe antigo em texto
    }
  })();
  return {
    overrides,
    reported: reported.map((r) => ({ service: r.service, key: r.key, value: r.value })),
    lastReport: [...last].map(([service, at]) => ({ service, at })),
    aiCredit: c ? { status: c.status, provider, checkedAt: new Date(c.checked_at) } : null,
  };
}

/** Gasto em US$ do dia de orçamento (todos os agentes; a mesma soma do teto global do ledger). */
export async function aiSpendUsd(db: Database, budgetDay: string): Promise<number> {
  const [row] = await db.execute<{ usd: string | number | null }>(sql`
    select coalesce(sum(cost_usd), 0) as usd from ops.llm_usage
     where coalesce(budget_day, day_utc) = ${budgetDay}::date`);
  return Number(row?.usd ?? 0);
}
