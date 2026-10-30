import { performance } from 'node:perf_hooks';
import { API_SPORTS, utcDayString, type QuotaPolicy } from '@galaxie/apisports-client';
import type { Database } from '@galaxie/db';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { aiBudget, effectiveOpsSettings, jobExpectations, type JobExpectation } from './ops.js';
import {
  aiSpendUsd,
  changeFeedConsumers,
  dbSizes,
  jobStats,
  ledgerCounts,
  liveEvents,
  liveSchedulerStates,
  opsState,
  plannedBudgets,
  providerSnapshots,
  rawFreshness,
  type ChangeFeedConsumerRow,
  type DbSizeData,
  type JobStatsRow,
  type LedgerCountRow,
  type LiveRow,
  type LiveSchedulerRow,
  type FreshnessRow,
  type OpsStateRow,
} from './queries.js';
import { computeQuotaStates, type QuotaState } from './quota.js';

export interface MetricsOptions {
  /** Sem banco, só as métricas de processo e de HTTP são expostas. */
  db?: Database | undefined;
  /** Política do Quota Governor por API (mesma do ingestor). Obrigatória quando há banco. */
  policyFor?: ((api: string) => QuotaPolicy) | undefined;
  /** APIs reportadas no painel de cota. Padrão: as 12 da api-sports. */
  apis?: readonly string[] | undefined;
  /** Intervalo esperado do live poller (s). Placeholder até o Live Scheduler definir o intervalo dinâmico. */
  livePollIntervalSeconds?: number | undefined;
  /** Janela (h) olhada para o frescor do raw. Padrão: 7 dias. */
  freshnessWindowHours?: number | undefined;
  /** Cache das consultas ao banco entre coletas (ms) — protege o Postgres de vários scrapers. Padrão: 5 s. */
  cacheMs?: number | undefined;
  /** Métricas padrão do Node (CPU, memória, event loop). Padrão: true. */
  defaultMetrics?: boolean | undefined;
  now?: (() => Date) | undefined;
  /** Chamado quando uma consulta de métricas falha (para log). */
  onCollectorError?: ((collector: string, err: unknown) => void) | undefined;
}

export interface GalaxieMetrics {
  registry: Registry;
  /** Latência das requisições HTTP da API (labels: method, route, status_code). */
  httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  /** Streams SSE abertos neste processo. */
  sseConnections: Gauge;
  /** Aberturas de SSE recusadas: `process_limit` (503, teto do processo) ou `tenant_limit` (429). */
  sseRejected: Counter<'reason'>;
  /** Lacunas do change feed abandonadas por consumidor (`sse`, `cache-purge`): mudanças que podem ter se perdido. */
  gapsAbandoned: Counter<'consumer' | 'reason'>;
  /** Respostas das rotas cacheadas: `hit`, `miss`, `stale` (valor anterior durante o recálculo), `coalesced`. */
  cacheResults: Counter<'result'>;
}

/** Buckets alinhados ao NFR de p95 ≤ 150 ms (docs/02 §7). */
export const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5, 10];

interface GroupResult<T> {
  ok: boolean;
  data?: T;
  seconds: number;
}

/** Uma consulta compartilhada por várias métricas na mesma coleta (executa no máximo uma vez a cada `ttlMs`). */
class CollectorGroup<T> {
  private pending: Promise<GroupResult<T>> | undefined;
  private startedAt = 0;

  constructor(
    readonly name: string,
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    private readonly onError?: (collector: string, err: unknown) => void,
  ) {}

  get(): Promise<GroupResult<T>> {
    const now = Date.now();
    if (!this.pending || now - this.startedAt >= this.ttlMs) {
      this.startedAt = now;
      this.pending = this.run();
    }
    return this.pending;
  }

  private async run(): Promise<GroupResult<T>> {
    const start = performance.now();
    try {
      const data = await this.load();
      return { ok: true, data, seconds: (performance.now() - start) / 1000 };
    } catch (err) {
      this.onError?.(this.name, err);
      return { ok: false, seconds: (performance.now() - start) / 1000 };
    }
  }
}

function dbGauge<T, L extends string>(
  registry: Registry,
  group: CollectorGroup<T>,
  name: string,
  help: string,
  labelNames: readonly L[],
  fill: (gauge: Gauge<L>, data: T) => void,
): Gauge<L> {
  const gauge: Gauge<L> = new Gauge<L>({
    name,
    help,
    labelNames,
    registers: [registry],
    async collect() {
      const result = await group.get();
      gauge.reset();
      if (result.ok && result.data !== undefined) fill(gauge, result.data);
    },
  });
  return gauge;
}

const seconds = (d: Date) => d.getTime() / 1000;

interface OpsData {
  state: OpsStateRow;
  jobs: JobExpectation[];
  ai: { dailyUsd: number | null; budgetDay: string; spentUsd: number };
}

interface QuotaData {
  dayUtc: string;
  yesterday: string;
  ledger: LedgerCountRow[];
  states: QuotaState[];
}

/** Registro Prometheus do Galaxie Sports: cota, jobs, frescor do raw, ao vivo, change feed e latência HTTP. */
export function createMetrics(options: MetricsOptions = {}): GalaxieMetrics {
  const registry = new Registry();
  if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram<'method' | 'route' | 'status_code'>({
    name: 'galaxie_http_request_duration_seconds',
    help: 'Latência das requisições HTTP da API por método, rota (template) e status',
    labelNames: ['method', 'route', 'status_code'],
    buckets: HTTP_BUCKETS,
    registers: [registry],
  });

  const sseConnections = new Gauge({
    name: 'galaxie_sse_connections_open',
    help: 'Streams SSE (GET /v1/stream) abertos neste processo da API',
    registers: [registry],
  });
  const sseRejected = new Counter<'reason'>({
    name: 'galaxie_sse_connections_rejected_total',
    help: 'Aberturas de SSE recusadas: process_limit (503, SSE_MAX_CONNECTIONS) ou tenant_limit (429)',
    labelNames: ['reason'],
    registers: [registry],
  });
  const gapsAbandoned = new Counter<'consumer' | 'reason'>({
    name: 'galaxie_change_feed_gaps_abandoned_total',
    help: 'Lacunas do ops.change_feed abandonadas pelo GapCursor (timeout depois da releitura ou max_seen)',
    labelNames: ['consumer', 'reason'],
    registers: [registry],
  });
  const cacheResults = new Counter<'result'>({
    name: 'galaxie_cache_requests_total',
    help: 'Respostas das rotas cacheadas por resultado: hit, miss, stale (servida durante o recálculo) e coalesced',
    labelNames: ['result'],
    registers: [registry],
  });
  // séries criadas em 0: sem isso, o increase() dos alertas não vê o primeiro incremento de uma série nova
  for (const reason of ['process_limit', 'tenant_limit']) sseRejected.inc({ reason }, 0);
  for (const consumer of ['sse', 'cache-purge'])
    for (const reason of ['timeout', 'max_seen']) gapsAbandoned.inc({ consumer, reason }, 0);
  for (const result of ['hit', 'miss', 'stale', 'coalesced']) cacheResults.inc({ result }, 0);
  const runtime = { sseConnections, sseRejected, gapsAbandoned, cacheResults };

  const livePoll = new Gauge({
    name: 'galaxie_live_poll_interval_seconds',
    help: 'Intervalo esperado entre atualizações ao vivo (placeholder até o Live Scheduler; LIVE_POLL_INTERVAL_SECONDS)',
    registers: [registry],
  });
  livePoll.set(options.livePollIntervalSeconds ?? 300);

  const db = options.db;
  if (!db) return { registry, httpDuration, ...runtime };

  const policyFor = options.policyFor;
  if (!policyFor) throw new Error('createMetrics: informe policyFor quando houver banco.');
  const apis = options.apis ?? API_SPORTS;
  const now = options.now ?? (() => new Date());
  const ttl = Math.max(1_000, options.cacheMs ?? 5_000);
  const windowHours = options.freshnessWindowHours ?? 24 * 7;
  const onError = options.onCollectorError;

  const quota = new CollectorGroup<QuotaData>(
    'quota',
    async () => {
      const today = now();
      const dayUtc = utcDayString(today);
      const yesterday = utcDayString(new Date(today.getTime() - 86_400_000));
      const [ledger, snapshots, budgets] = await Promise.all([
        ledgerCounts(db, apis, yesterday),
        providerSnapshots(db, dayUtc),
        plannedBudgets(db, dayUtc),
      ]);
      return {
        dayUtc,
        yesterday,
        ledger,
        states: computeQuotaStates(apis, dayUtc, policyFor, ledger, snapshots, budgets),
      };
    },
    ttl,
    onError,
  );
  const jobs = new CollectorGroup<JobStatsRow[]>('jobs', () => jobStats(db), ttl, onError);
  const freshness = new CollectorGroup<FreshnessRow[]>(
    'freshness',
    () => rawFreshness(db, apis, windowHours),
    ttl,
    onError,
  );
  // eventos em andamento e estado do Live Scheduler na mesma coleta (em sequência: não aumenta a concorrência no banco)
  const live = new CollectorGroup<{ events: LiveRow[]; scheduler: LiveSchedulerRow[] }>(
    'live',
    async () => ({ events: await liveEvents(db), scheduler: await liveSchedulerStates(db) }),
    ttl,
    onError,
  );
  // tamanho muda devagar: no máximo uma leitura por minuto, por mais scrapers que haja
  const sizes = new CollectorGroup<DbSizeData>('db_size', () => dbSizes(db), Math.max(ttl, 60_000), onError);
  const changeFeed = new CollectorGroup<ChangeFeedConsumerRow[]>(
    'change_feed',
    () => changeFeedConsumers(db),
    ttl,
    onError,
  );
  // configuração efetiva (agendas, teto da IA), sinais de vida dos schedulers e crédito/gasto da IA
  const ops = new CollectorGroup<OpsData>(
    'ops',
    async () => {
      const at = now();
      const state = await opsState(db);
      const settings = effectiveOpsSettings(state.overrides, state.reported);
      const budget = aiBudget(settings, at);
      return {
        state,
        jobs: jobExpectations(settings, at),
        ai: { ...budget, spentUsd: await aiSpendUsd(db, budget.budgetDay) },
      };
    },
    ttl,
    onError,
  );
  const groups = [quota, jobs, freshness, live, changeFeed, ops] as CollectorGroup<unknown>[];

  // ── cota (fonte: ops.quota_ledger / quota_snapshot / quota_budget) ──────────────────────────────
  dbGauge(
    registry,
    quota,
    'galaxie_provider_calls',
    'Chamadas ao fornecedor registradas no ledger (hoje e ontem, UTC) por API, prioridade e desfecho',
    ['api', 'day_utc', 'period', 'priority', 'outcome'],
    (g, d) => {
      for (const r of d.ledger) {
        const period = r.dayUtc === d.dayUtc ? 'today' : r.dayUtc === d.yesterday ? 'yesterday' : 'older';
        g.set({ api: r.api, day_utc: r.dayUtc, period, priority: r.priority, outcome: r.outcome }, r.calls);
      }
    },
  );
  const perApi = (name: string, help: string, value: (s: QuotaState) => number | undefined): Gauge<'api'> =>
    dbGauge(registry, quota, name, help, ['api'], (g, d) => {
      for (const s of d.states) {
        const v = value(s);
        if (v !== undefined) g.set({ api: s.api }, v);
      }
    });
  perApi('galaxie_quota_daily_limit', 'Limite diário efetivo de chamadas por API', (s) => s.dailyLimit);
  perApi('galaxie_quota_reserve', 'Reserva (na produção, só o LIVE usa; no dev, ninguém)', (s) => s.reserve);
  perApi(
    'galaxie_quota_used',
    'Uso efetivo do dia: máximo entre o ledger e o contador do fornecedor',
    (s) => s.effectiveUsed,
  );
  perApi('galaxie_quota_remaining', 'Chamadas restantes no dia (limite − uso efetivo)', (s) => s.remaining);
  perApi('galaxie_quota_remaining_ratio', 'Fração da cota diária restante (0..1)', (s) => s.remainingRatio);
  perApi(
    'galaxie_quota_provider_used',
    'Contador do fornecedor (/status) + chamadas posteriores à leitura',
    (s) => s.providerUsed,
  );
  dbGauge(
    registry,
    quota,
    'galaxie_quota_budget',
    'Orçamento do dia por API e prioridade (plano do dia ou fatia padrão da política)',
    ['api', 'priority'],
    (g, d) => {
      for (const s of d.states) {
        for (const [priority, value] of Object.entries(s.budget)) g.set({ api: s.api, priority }, value);
      }
    },
  );

  // ── jobs (fonte: ops.job_run) ────────────────────────────────────────────────────────────────────
  dbGauge(
    registry,
    jobs,
    'galaxie_job_runs',
    'Execuções de jobs nas últimas 24 h por status',
    ['job_name', 'status'],
    (g, rows) => {
      for (const r of rows)
        for (const [status, n] of Object.entries(r.runs24h)) g.set({ job_name: r.job, status }, n);
    },
  );
  dbGauge(
    registry,
    jobs,
    'galaxie_job_consecutive_failures',
    'Falhas seguidas desde o último sucesso',
    ['job_name'],
    (g, rows) => {
      for (const r of rows) g.set({ job_name: r.job }, r.consecutiveFailures);
    },
  );
  dbGauge(
    registry,
    jobs,
    'galaxie_job_last_run_timestamp_seconds',
    'Início da execução mais recente (epoch s)',
    ['job_name'],
    (g, rows) => {
      for (const r of rows) g.set({ job_name: r.job }, seconds(r.lastStartedAt));
    },
  );
  dbGauge(
    registry,
    jobs,
    'galaxie_job_last_success_timestamp_seconds',
    'Início da última execução com sucesso (epoch s)',
    ['job_name'],
    (g, rows) => {
      for (const r of rows) if (r.lastSuccessAt) g.set({ job_name: r.job }, seconds(r.lastSuccessAt));
    },
  );
  dbGauge(
    registry,
    jobs,
    'galaxie_job_first_run_timestamp_seconds',
    'Primeira execução registrada do job (epoch s): dá idade a um job que nunca teve sucesso',
    ['job_name'],
    (g, rows) => {
      for (const r of rows) g.set({ job_name: r.job }, seconds(r.firstStartedAt));
    },
  );
  dbGauge(
    registry,
    jobs,
    'galaxie_job_running_since_timestamp_seconds',
    'Início da execução em andamento (epoch s); ausente sem execução rodando',
    ['job_name'],
    (g, rows) => {
      for (const r of rows)
        if (r.lastStatus === 'running') g.set({ job_name: r.job }, seconds(r.lastStartedAt));
    },
  );
  dbGauge(
    registry,
    jobs,
    'galaxie_job_last_duration_seconds',
    'Duração da execução mais recente já concluída (s)',
    ['job_name'],
    (g, rows) => {
      for (const r of rows) {
        if (r.lastFinishedAt)
          g.set({ job_name: r.job }, (r.lastFinishedAt.getTime() - r.lastStartedAt.getTime()) / 1000);
      }
    },
  );

  // ── tamanho do banco (retenção, lote 6; alerta DatabaseGrowingFast) ─────────────────────────────
  dbGauge(
    registry,
    sizes,
    'galaxie_db_database_bytes',
    'Tamanho do banco (pg_database_size, bytes)',
    [],
    (g, d) => g.set(d.databaseBytes),
  );
  dbGauge(
    registry,
    sizes,
    'galaxie_db_table_bytes',
    'Tamanho das maiores tabelas e das que a retenção poda (tabela + índices + TOAST, bytes)',
    ['table'],
    (g, d) => {
      for (const r of d.tables) g.set({ table: r.table }, r.bytes);
    },
  );

  // ── frescor do raw ───────────────────────────────────────────────────────────────────────────────
  dbGauge(
    registry,
    freshness,
    'galaxie_raw_last_fetched_timestamp_seconds',
    'Última resposta recebida em raw.api_response por esporte, nova ou repetida (last_seen_at; epoch s; só a janela recente)',
    ['sport'],
    (g, rows) => {
      for (const r of rows) g.set({ sport: r.sport }, seconds(r.lastFetchedAt));
    },
  );

  // ── ao vivo (fonte: core.event) ──────────────────────────────────────────────────────────────────
  // coverage: poller (no plano do ao vivo) ou clock (só o relógio dos eventos; o alerta não olha estes)
  dbGauge(
    registry,
    live,
    'galaxie_live_events',
    'Eventos em andamento por esporte e cobertura (poller = no plano do ao vivo; clock = só pelo relógio)',
    ['sport', 'coverage'],
    (g, d) => {
      for (const r of d.events) g.set({ sport: r.sport, coverage: r.coverage }, r.events);
    },
  );
  dbGauge(
    registry,
    live,
    'galaxie_live_event_max_staleness_seconds',
    'Maior tempo sem atualização válida, desde o apito, entre os eventos em andamento (s)',
    ['sport', 'coverage'],
    (g, d) => {
      for (const r of d.events) g.set({ sport: r.sport, coverage: r.coverage }, r.maxStalenessSeconds);
    },
  );

  // ── Live Scheduler (fonte: ops.sync_cursor, publicado pelo processo do ao vivo) ─────────────────────
  dbGauge(
    registry,
    live,
    'galaxie_live_scheduler_interval_seconds',
    'Intervalo médio planejado pelo Live Scheduler (minutos de janela ÷ orçamento LIVE, mínimo 15 s)',
    ['sport'],
    (g, d) => {
      for (const r of d.scheduler)
        if (r.intervalSeconds !== null) g.set({ sport: r.sport }, r.intervalSeconds);
    },
  );
  dbGauge(
    registry,
    live,
    'galaxie_live_scheduler_ticks_left',
    'Ticks que ainda cabem no orçamento LIVE do dia',
    ['sport'],
    (g, d) => {
      for (const r of d.scheduler) g.set({ sport: r.sport }, r.ticksLeft);
    },
  );
  dbGauge(
    registry,
    live,
    'galaxie_live_scheduler_window_minutes',
    'Minutos de janela ao vivo que restam no dia de cota',
    ['sport'],
    (g, d) => {
      for (const r of d.scheduler) g.set({ sport: r.sport }, r.windowMinutes);
    },
  );
  dbGauge(
    registry,
    live,
    'galaxie_live_scheduler_active_events',
    'Jogos em janela ao vivo agora',
    ['sport'],
    (g, d) => {
      for (const r of d.scheduler) g.set({ sport: r.sport }, r.activeEvents);
    },
  );
  dbGauge(
    registry,
    live,
    'galaxie_live_scheduler_updated_timestamp_seconds',
    'Última atualização do estado do Live Scheduler (epoch s)',
    ['sport'],
    (g, d) => {
      for (const r of d.scheduler) g.set({ sport: r.sport }, seconds(r.updatedAt));
    },
  );

  // ── change feed (fonte: cursores salvos dos consumidores) ────────────────────────────────────────
  dbGauge(
    registry,
    changeFeed,
    'galaxie_change_feed_pending',
    'Mudanças do ops.change_feed depois do cursor do consumidor (até 10 000)',
    ['consumer'],
    (g, rows) => {
      for (const r of rows) g.set({ consumer: r.consumer }, r.pending);
    },
  );
  dbGauge(
    registry,
    changeFeed,
    'galaxie_change_feed_pending_age_seconds',
    'Idade da mudança pendente mais antiga do consumidor (s; 0 = em dia)',
    ['consumer'],
    (g, rows) => {
      for (const r of rows) g.set({ consumer: r.consumer }, r.oldestPendingAgeSeconds);
    },
  );

  // ── sinais de vida, agenda esperada e IA (fonte: ops.runtime_env, ops.runtime_setting, ops.runtime_check, ops.llm_usage)
  dbGauge(
    registry,
    ops,
    'galaxie_service_last_report_timestamp_seconds',
    'Último relato do serviço em ops.runtime_env (epoch s; os schedulers relatam a cada 30 s, a API só na partida). ' +
      'Rótulo `component`: o scrape já põe `service` no alvo',
    ['component'],
    (g, d) => {
      for (const r of d.state.lastReport) g.set({ component: r.service }, seconds(r.at));
    },
  );
  dbGauge(
    registry,
    ops,
    'galaxie_job_expected_interval_seconds',
    'Maior intervalo entre execuções na agenda efetiva do job (banco > env do serviço > padrão; só jobs ligados)',
    ['job_name', 'component'],
    (g, d) => {
      for (const j of d.jobs) g.set({ job_name: j.job, component: j.service }, j.intervalSeconds);
    },
  );
  dbGauge(
    registry,
    ops,
    'galaxie_ai_credit_check',
    'Resultado da última checagem do crédito da conta de IA (1 no status atual: pass, warn ou fail)',
    ['status', 'provider'],
    (g, d) => {
      const c = d.state.aiCredit;
      if (c) g.set({ status: c.status, provider: c.provider ?? '' }, 1);
    },
  );
  dbGauge(
    registry,
    ops,
    'galaxie_ai_credit_checked_timestamp_seconds',
    'Hora da última checagem do crédito da conta de IA (epoch s)',
    [],
    (g, d) => {
      if (d.state.aiCredit) g.set(seconds(d.state.aiCredit.checkedAt));
    },
  );
  dbGauge(
    registry,
    ops,
    'galaxie_ai_spend_usd',
    'Gasto de IA em US$ no dia de orçamento corrente (ops.llm_usage, todos os agentes)',
    ['budget_day'],
    (g, d) => {
      g.set({ budget_day: d.ai.budgetDay }, d.ai.spentUsd);
    },
  );
  dbGauge(
    registry,
    ops,
    'galaxie_ai_daily_budget_usd',
    'Teto diário global da IA em US$ (AI_DAILY_USD_BUDGET efetivo; ausente = unlimited)',
    [],
    (g, d) => {
      if (d.ai.dailyUsd !== null) g.set(d.ai.dailyUsd);
    },
  );

  // ── saúde dos coletores (registrado por último: reflete a coleta corrente) ───────────────────────
  const up: Gauge<'collector'> = new Gauge<'collector'>({
    name: 'galaxie_metrics_collector_up',
    help: '1 se a consulta do coletor funcionou na última coleta, 0 se falhou (ex.: banco fora)',
    labelNames: ['collector'],
    registers: [registry],
    async collect() {
      for (const group of groups) up.set({ collector: group.name }, (await group.get()).ok ? 1 : 0);
    },
  });
  const duration: Gauge<'collector'> = new Gauge<'collector'>({
    name: 'galaxie_metrics_collector_duration_seconds',
    help: 'Duração da consulta do coletor (s)',
    labelNames: ['collector'],
    registers: [registry],
    async collect() {
      for (const group of groups) duration.set({ collector: group.name }, (await group.get()).seconds);
    },
  });

  return { registry, httpDuration, ...runtime };
}
