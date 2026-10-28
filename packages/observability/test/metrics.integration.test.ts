import { randomBytes } from 'node:crypto';
import { defaultPolicy } from '@galaxie/apisports-client';
import {
  apiResponse,
  changeFeed,
  closeDb,
  createDb,
  event,
  jobRun,
  quotaBudget,
  quotaLedger,
  quotaSnapshot,
  runMigrations,
  sport,
  syncCursor,
  webhookCursor,
  type Database,
} from '@galaxie/db';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetrics } from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;

// O dia de cota vem do relógio injetado; frescor, jobs e ao vivo usam now() do banco.
const realNow = new Date();
const today = realNow.toISOString().slice(0, 10);
const yesterday = new Date(realNow.getTime() - 86_400_000).toISOString().slice(0, 10);
const ago = (ms: number) => new Date(realNow.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

type MetricJson = { name: string; values: { labels: Record<string, string | number>; value: number }[] };

async function scrape(database: Database = db) {
  const { registry } = createMetrics({
    db: database,
    policyFor: () => defaultPolicy(100, 15),
    defaultMetrics: false,
    now: () => realNow,
    livePollIntervalSeconds: 240,
  });
  const json = (await registry.getMetricsAsJSON()) as unknown as MetricJson[];
  const get = (name: string, labels: Record<string, string> = {}) =>
    json
      .find((m) => m.name === name)
      ?.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value;
  const series = (name: string) => json.find((m) => m.name === name)?.values ?? [];
  return { get, series, text: await registry.metrics() };
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });

  // ── cota ──
  const ledger = (n: number, row: Partial<typeof quotaLedger.$inferInsert>) =>
    Array.from({ length: n }, (_, i) => ({
      api: 'football',
      dayUtc: today,
      priority: 'DAILY' as const,
      endpoint: '/fixtures',
      requestHash: `h${Math.random()}${i}`,
      outcome: 'ok',
      sentAt: ago(3 * HOUR),
      ...row,
    }));
  await db
    .insert(quotaLedger)
    .values([
      ...ledger(30, {}),
      ...ledger(2, { outcome: 'plan_error' }),
      ...ledger(1, { priority: 'LIVE', outcome: 'pending', sentAt: ago(1 * MIN) }),
      ...ledger(4, { priority: 'LIVE', sentAt: ago(30 * MIN) }),
      ...ledger(50, { dayUtc: yesterday, sentAt: ago(25 * HOUR) }),
      ...ledger(3, { api: 'basketball', priority: 'BOOTSTRAP' }),
    ]);
  // contador do fornecedor lido há 1 h: 20 + 5 chamadas posteriores (4 LIVE ok + 1 pendente) = 25 < 37 do ledger
  await db.insert(quotaSnapshot).values({
    api: 'football',
    dayUtc: today,
    providerUsed: 20,
    providerLimit: 100,
    plan: 'Free',
    capturedAt: ago(1 * HOUR),
  });
  // basketball: fornecedor viu 90 (chamadas feitas fora do nosso ledger) → uso efetivo 90, restam 10%
  await db.insert(quotaSnapshot).values({
    api: 'basketball',
    dayUtc: today,
    providerUsed: 90,
    providerLimit: 100,
    plan: 'Free',
    capturedAt: ago(10 * MIN),
  });
  await db.insert(quotaBudget).values({ api: 'football', dayUtc: today, priority: 'LIVE', planned: 10 });

  // ── jobs ──
  const run = (job: string, status: string, startedMs: number) => ({
    job,
    status,
    startedAt: ago(startedMs),
    finishedAt: status === 'running' ? null : ago(startedMs - 2 * MIN),
  });
  await db.insert(jobRun).values([
    run('daily-sync', 'ok', 4 * HOUR),
    run('daily-sync', 'error', 3 * HOUR),
    run('daily-sync', 'error', 2 * HOUR),
    run('daily-sync', 'error', 1 * HOUR),
    run('quota-status', 'error', 3 * HOUR),
    run('quota-status', 'ok', 2 * HOUR),
    run('never-ok', 'error', 30 * HOUR),
    run('never-ok', 'error', 20 * MIN),
    // orçamento de IA recusou: gravou o determinístico, conta como sucesso (não como falha seguida)
    run('recap-run', 'error', 3 * HOUR),
    run('recap-run', 'budget_skipped', 2 * HOUR),
    run('recap-run', 'error', 1 * HOUR),
  ]);

  // ── raw ──
  const raw = (s: string, fetchedAt: Date) => ({
    sport: s,
    apiVersion: 'v3',
    endpoint: '/fixtures',
    params: {},
    requestHash: `r${Math.random()}`,
    statusCode: 200,
    body: {},
    bodyHash: `b${Math.random()}`,
    fetchedAt,
  });
  await db
    .insert(apiResponse)
    .values([
      raw('football', ago(10 * MIN)),
      raw('football', ago(48 * HOUR)),
      raw('hockey', ago(30 * 24 * HOUR)),
    ]);

  // ── ao vivo ──
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(event).values([
    {
      sport: 'football',
      startsAt: ago(HOUR),
      endsAtExpected: ago(-HOUR),
      status: 'live',
      lastValidAt: ago(15 * MIN),
    },
    {
      sport: 'football',
      startsAt: ago(HOUR),
      endsAtExpected: ago(-HOUR),
      status: 'break',
      lastValidAt: ago(2 * MIN),
    },
    {
      sport: 'football',
      startsAt: ago(3 * HOUR),
      endsAtExpected: ago(HOUR),
      status: 'finished',
      lastValidAt: ago(5 * HOUR),
    },
  ]);
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('métricas de cota (ops.quota_ledger)', () => {
  it('chamadas por API, dia, prioridade e desfecho', async () => {
    const m = await scrape();
    expect(
      m.get('galaxie_provider_calls', { api: 'football', period: 'today', priority: 'DAILY', outcome: 'ok' }),
    ).toBe(30);
    expect(
      m.get('galaxie_provider_calls', {
        api: 'football',
        period: 'today',
        priority: 'DAILY',
        outcome: 'plan_error',
      }),
    ).toBe(2);
    expect(
      m.get('galaxie_provider_calls', {
        api: 'football',
        period: 'today',
        priority: 'LIVE',
        outcome: 'pending',
      }),
    ).toBe(1);
    expect(
      m.get('galaxie_provider_calls', { api: 'football', period: 'yesterday', day_utc: yesterday }),
    ).toBe(50);
    expect(m.get('galaxie_provider_calls', { api: 'basketball', priority: 'BOOTSTRAP' })).toBe(3);
  });

  it('restante = limite − max(ledger, fornecedor), sem somar as duas fontes', async () => {
    const m = await scrape();
    expect(m.get('galaxie_quota_provider_used', { api: 'football' })).toBe(25);
    expect(m.get('galaxie_quota_used', { api: 'football' })).toBe(37);
    expect(m.get('galaxie_quota_remaining', { api: 'football' })).toBe(63);
    expect(m.get('galaxie_quota_remaining_ratio', { api: 'football' })).toBeCloseTo(0.63);

    expect(m.get('galaxie_quota_used', { api: 'basketball' })).toBe(90);
    expect(m.get('galaxie_quota_remaining_ratio', { api: 'basketball' })).toBeCloseTo(0.1);

    expect(m.get('galaxie_quota_remaining_ratio', { api: 'mma' })).toBe(1);
    expect(m.get('galaxie_quota_daily_limit', { api: 'mma' })).toBe(100);
    expect(m.series('galaxie_quota_remaining')).toHaveLength(12);
  });

  it('orçamento do dia respeita o plano gravado em ops.quota_budget', async () => {
    const m = await scrape();
    expect(m.get('galaxie_quota_budget', { api: 'football', priority: 'LIVE' })).toBe(10);
    expect(m.get('galaxie_quota_budget', { api: 'football', priority: 'DAILY' })).toBe(40);
    expect(m.get('galaxie_quota_reserve', { api: 'football' })).toBe(15);
  });

  it('várias réplicas raspando o mesmo banco reportam os mesmos números', async () => {
    const [a, b] = await Promise.all([scrape(), scrape()]);
    expect(a.get('galaxie_quota_used', { api: 'football' })).toBe(
      b.get('galaxie_quota_used', { api: 'football' }),
    );
  });
});

describe('métricas de jobs (ops.job_run)', () => {
  it('conta falhas seguidas desde o último sucesso', async () => {
    const m = await scrape();
    expect(m.get('galaxie_job_consecutive_failures', { job_name: 'daily-sync' })).toBe(3);
    expect(m.get('galaxie_job_consecutive_failures', { job_name: 'quota-status' })).toBe(0);
    expect(m.get('galaxie_job_consecutive_failures', { job_name: 'never-ok' })).toBe(2);
    // budget_skipped zera a contagem e é o último sucesso
    expect(m.get('galaxie_job_consecutive_failures', { job_name: 'recap-run' })).toBe(1);
    expect(m.get('galaxie_job_last_success_timestamp_seconds', { job_name: 'recap-run' })).toBeCloseTo(
      ago(2 * HOUR).getTime() / 1000,
      0,
    );
  });

  it('execuções nas últimas 24 h e horários da última execução', async () => {
    const m = await scrape();
    expect(m.get('galaxie_job_runs', { job_name: 'daily-sync', status: 'error' })).toBe(3);
    expect(m.get('galaxie_job_runs', { job_name: 'daily-sync', status: 'ok' })).toBe(1);
    expect(m.get('galaxie_job_runs', { job_name: 'never-ok', status: 'error' })).toBe(1);
    expect(m.get('galaxie_job_last_run_timestamp_seconds', { job_name: 'daily-sync' })).toBeCloseTo(
      ago(HOUR).getTime() / 1000,
      0,
    );
    expect(m.get('galaxie_job_last_success_timestamp_seconds', { job_name: 'daily-sync' })).toBeCloseTo(
      ago(4 * HOUR).getTime() / 1000,
      0,
    );
    expect(m.get('galaxie_job_last_success_timestamp_seconds', { job_name: 'never-ok' })).toBeUndefined();
    // job que nunca teve sucesso continua com idade: a da primeira execução
    expect(m.get('galaxie_job_first_run_timestamp_seconds', { job_name: 'never-ok' })).toBeCloseTo(
      ago(30 * HOUR).getTime() / 1000,
      0,
    );
    expect(m.get('galaxie_job_first_run_timestamp_seconds', { job_name: 'daily-sync' })).toBeCloseTo(
      ago(4 * HOUR).getTime() / 1000,
      0,
    );
    expect(m.get('galaxie_job_last_duration_seconds', { job_name: 'daily-sync' })).toBeCloseTo(120, 0);
  });
});

describe('frescor e ao vivo', () => {
  it('última resposta do raw por esporte, só na janela recente', async () => {
    const m = await scrape();
    expect(m.get('galaxie_raw_last_fetched_timestamp_seconds', { sport: 'football' })).toBeCloseTo(
      ago(10 * MIN).getTime() / 1000,
      0,
    );
    expect(m.get('galaxie_raw_last_fetched_timestamp_seconds', { sport: 'hockey' })).toBeUndefined();
  });

  it('eventos em andamento e o mais desatualizado', async () => {
    const m = await scrape();
    expect(m.get('galaxie_live_events', { sport: 'football' })).toBe(2);
    const staleness = m.get('galaxie_live_event_max_staleness_seconds', { sport: 'football' })!;
    expect(staleness).toBeGreaterThan(15 * 60 - 5);
    expect(staleness).toBeLessThan(15 * 60 + 120);
    expect(m.get('galaxie_live_poll_interval_seconds')).toBe(240);
  });

  it('estado do Live Scheduler publicado pelo processo do ao vivo', async () => {
    await db.insert(syncCursor).values({
      sport: 'football',
      endpoint: 'live:scheduler',
      key: 'state',
      cursor: {
        sport: 'football',
        intervalSeconds: 372.5,
        ticksLeft: 31,
        windowMinutes: 250,
        activeEvents: 3,
      },
      updatedAt: ago(MIN),
    });
    const m = await scrape();
    expect(m.get('galaxie_live_scheduler_interval_seconds', { sport: 'football' })).toBe(372.5);
    expect(m.get('galaxie_live_scheduler_ticks_left', { sport: 'football' })).toBe(31);
    expect(m.get('galaxie_live_scheduler_window_minutes', { sport: 'football' })).toBe(250);
    expect(m.get('galaxie_live_scheduler_active_events', { sport: 'football' })).toBe(3);
    expect(m.get('galaxie_live_scheduler_updated_timestamp_seconds', { sport: 'football' })).toBeCloseTo(
      ago(MIN).getTime() / 1000,
      0,
    );
  });

  it('consumidores do change feed: pendência e idade da mais antiga (cursor da demo só quando a tabela existe)', async () => {
    const ids = await db
      .insert(changeFeed)
      .values([
        { topic: 'event.status_changed', entityType: 'event', entityId: 'e1', createdAt: ago(20 * MIN) },
        { topic: 'event.status_changed', entityType: 'event', entityId: 'e2', createdAt: ago(5 * MIN) },
      ])
      .returning({ id: changeFeed.id });
    const [first, last] = ids.map((r) => r.id) as [number, number];
    // sem a tabela da demo: só o cursor de webhooks, em dia
    await db.insert(webhookCursor).values({ name: 'default', lastChangeId: last });
    let m = await scrape();
    expect(m.get('galaxie_change_feed_pending', { consumer: 'webhooks:default' })).toBe(0);
    expect(m.get('galaxie_change_feed_pending_age_seconds', { consumer: 'webhooks:default' })).toBe(0);
    expect(m.series('galaxie_change_feed_pending')).toHaveLength(1);

    // demo parada antes das duas mudanças: duas pendentes, a mais antiga com ~20 min
    await db.execute(sql`create schema if not exists demo_auth`);
    await db.execute(sql`
      create table demo_auth.cache_feed_cursor (name text primary key, last_change_id bigint not null,
        updated_at timestamptz not null default now())`);
    try {
      await db.execute(
        sql`insert into demo_auth.cache_feed_cursor (name, last_change_id) values ('demo', ${first - 1})`,
      );
      m = await scrape();
      expect(m.get('galaxie_change_feed_pending', { consumer: 'demo-cache:demo' })).toBe(2);
      const age = m.get('galaxie_change_feed_pending_age_seconds', { consumer: 'demo-cache:demo' })!;
      expect(age).toBeGreaterThan(20 * 60 - 5);
      expect(age).toBeLessThan(20 * 60 + 120);
    } finally {
      await db.execute(sql`drop schema demo_auth cascade`);
    }
  });

  it('coletores reportam saúde', async () => {
    const m = await scrape();
    for (const collector of ['quota', 'jobs', 'freshness', 'live', 'change_feed', 'ops']) {
      expect(m.get('galaxie_metrics_collector_up', { collector })).toBe(1);
    }
  });
});

describe('sinais de vida, agenda esperada e IA (ops.runtime_*, ops.llm_usage)', () => {
  // dia de orçamento padrão: vira às 06:00 de Brasília (09:00 UTC)
  const budgetDay = new Date(realNow.getTime() - 9 * HOUR).toISOString().slice(0, 10);

  beforeAll(async () => {
    await db.execute(sql`
      insert into ops.runtime_env (service, key, value, configured, reported_at) values
        ('ingestor', 'SCHEDULE_LIVE_RUN', '*/2 * * * *', true, now() - interval '20 seconds'),
        ('agents', 'AI_DAILY_USD_BUDGET', '12', true, now() - interval '30 minutes')`);
    await db.execute(sql`
      insert into ops.runtime_setting (key, value, value_type, updated_by) values
        ('SCHEDULE_WTW_RUN', 'off', 'cron', 'teste'),
        ('AI_DAILY_USD_BUDGET', '20', 'number', 'teste')`);
    await db.execute(sql`
      insert into ops.runtime_check (service, name, status, detail, checked_at) values
        ('agents', 'ai-credit-check', 'fail', '{"code":"http","provider":"gemini","http":429}', now() - interval '10 minutes')`);
    await db.execute(sql`
      insert into ops.llm_usage (day_utc, budget_day, agent, purpose, provider, model, tier, cost_usd, outcome) values
        (${budgetDay}::date, ${budgetDay}::date, 'wtw', 'wtw', 'gemini', 'm', 'light', 3.5, 'ok'),
        (${budgetDay}::date, null, 'context', 'context', 'gemini', 'm', 'light', 1.25, 'ok'),
        (${budgetDay}::date - 1, ${budgetDay}::date - 1, 'wtw', 'wtw', 'gemini', 'm', 'light', 9, 'ok')`);
  });

  it('último relato de cada serviço', async () => {
    const m = await scrape();
    const ingestor = m.get('galaxie_service_last_report_timestamp_seconds', { component: 'ingestor' })!;
    expect(Date.now() / 1000 - ingestor).toBeLessThan(120);
    const agents = m.get('galaxie_service_last_report_timestamp_seconds', { component: 'agents' })!;
    expect(Date.now() / 1000 - agents).toBeGreaterThan(25 * 60);
  });

  it('intervalo esperado pela agenda efetiva (banco > env relatado > padrão)', async () => {
    const m = await scrape();
    expect(
      m.get('galaxie_job_expected_interval_seconds', { job_name: 'live-run', component: 'ingestor' }),
    ).toBe(120);
    expect(m.get('galaxie_job_expected_interval_seconds', { job_name: 'quota-status' })).toBe(3600);
    expect(m.get('galaxie_job_expected_interval_seconds', { job_name: 'wtw-run' })).toBeUndefined();
  });

  it('crédito da IA e gasto do dia de orçamento contra o teto', async () => {
    const m = await scrape();
    expect(m.get('galaxie_ai_credit_check', { status: 'fail', provider: 'gemini' })).toBe(1);
    expect(m.get('galaxie_ai_spend_usd', { budget_day: budgetDay })).toBeCloseTo(4.75);
    expect(m.get('galaxie_ai_daily_budget_usd')).toBe(20);
  });
});

describe('banco indisponível', () => {
  it('a coleta não falha: coletores ficam com up = 0 e as métricas do banco somem', async () => {
    const u = new URL(testUrl);
    u.port = '1';
    // uma conexão por coletor: com max 1 as consultas fazem fila atrás do recuo de reconexão do postgres.js
    const broken = createDb(u.toString(), { max: 8 });
    try {
      const m = await scrape(broken);
      expect(m.get('galaxie_metrics_collector_up', { collector: 'quota' })).toBe(0);
      expect(m.series('galaxie_quota_remaining')).toHaveLength(0);
      expect(m.text).toContain('galaxie_live_poll_interval_seconds 240');
    } finally {
      await closeDb(broken);
    }
  });
});
