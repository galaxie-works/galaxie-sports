import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPolicy } from '@galaxie/apisports-client';
import { closeDb, createDb, jobRun, runMigrations, type Database } from '@galaxie/db';
import { createLogger, createMetrics } from '@galaxie/observability';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgRunRecorder, runJob } from '../src/scheduler/runner.js';
import type { ScheduledJob } from '../src/scheduler/schedule.js';

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
let dir: string;
const logger = createLogger({ service: 'test', level: 'silent' });

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  dir = await mkdtemp(join(tmpdir(), 'galaxie-scheduler-'));
  await writeFile(join(dir, 'fail.mjs'), 'process.exit(1);');
  await writeFile(join(dir, 'ok.mjs'), '');
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
  await rm(dir, { recursive: true, force: true });
});

const job = (script: string): ScheduledJob => ({
  name: 'daily-sync',
  description: '',
  cron: '* * * * *',
  script,
  args: [],
  timeoutMs: 10_000,
});

async function consecutiveFailures(): Promise<number | undefined> {
  const { registry } = createMetrics({ db, policyFor: () => defaultPolicy(100), defaultMetrics: false });
  const metrics = (await registry.getMetricsAsJSON()) as unknown as {
    name: string;
    values: { labels: Record<string, string>; value: number }[];
  }[];
  return metrics
    .find((m) => m.name === 'galaxie_job_consecutive_failures')
    ?.values.find((v) => v.labels.job_name === 'daily-sync')?.value;
}

describe('scheduler → ops.job_run → métrica de falhas seguidas', () => {
  it('três falhas seguidas aparecem na métrica do alerta e um sucesso zera', async () => {
    const recorder = new PgRunRecorder(db);
    const options = { cwd: dir, recorder, logger, trigger: 'schedule' as const };

    const first = await runJob(job('fail.mjs'), options);
    const [row] = await db.select().from(jobRun).where(eq(jobRun.id, first.runId!));
    expect(row).toMatchObject({
      job: 'daily-sync',
      status: 'error',
      error: 'processo terminou com código 1',
    });
    expect(row!.finishedAt).toBeInstanceOf(Date);

    await runJob(job('fail.mjs'), options);
    await runJob(job('fail.mjs'), options);
    expect(await consecutiveFailures()).toBe(3);

    await runJob(job('ok.mjs'), options);
    expect(await consecutiveFailures()).toBe(0);
  });
});
