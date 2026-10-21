import { randomBytes } from 'node:crypto';
import { defaultPolicy } from '@galaxie/apisports-client';
import {
  apiResponse,
  closeDb,
  createDb,
  event,
  jobRun,
  quotaBudget,
  quotaLedger,
  quotaSnapshot,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
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
  await db
    .insert(jobRun)
    .values([
      run('daily-sync', 'ok', 4 * HOUR),
      run('daily-sync', 'error', 3 * HOUR),
      run('daily-sync', 'error', 2 * HOUR),
      run('daily-sync', 'error', 1 * HOUR),
      run('quota-status', 'error', 3 * HOUR),
      run('quota-status', 'ok', 2 * HOUR),
      run('never-ok', 'error', 30 * HOUR),
      run('never-ok', 'error', 20 * MIN),
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

  it('coletores reportam saúde', async () => {
    const m = await scrape();
    for (const collector of ['quota', 'jobs', 'freshness', 'live']) {
      expect(m.get('galaxie_metrics_collector_up', { collector })).toBe(1);
    }
  });
});

describe('banco indisponível', () => {
  it('a coleta não falha: coletores ficam com up = 0 e as métricas do banco somem', async () => {
    const u = new URL(testUrl);
    u.port = '1';
    const broken = createDb(u.toString(), { max: 1 });
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
