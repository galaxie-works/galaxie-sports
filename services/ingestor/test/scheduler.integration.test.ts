import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPolicy } from '@galaxie/apisports-client';
import {
  closeDb,
  createDb,
  jobRun,
  mergeJobRunStats,
  runMigrations,
  tryJobLock,
  type Database,
} from '@galaxie/db';
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
  await writeFile(join(dir, 'slow.mjs'), 'await new Promise((r) => setTimeout(r, 1500));');
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

describe('estatísticas do próprio job em ops.job_run', () => {
  it('o job soma as dele (GALAXIE_SCHEDULER_RUN_ID) e o fim do scheduler não as apaga', async () => {
    const recorder = new PgRunRecorder(db);
    const id = await recorder.start('lineups-revisit');
    await mergeJobRunStats(db, id, { lineups: { prompt_cuts: 2 } });
    await recorder.finish(id, 'ok', null, { exit_code: 0, duration_ms: 10 });
    const [row] = await db.select().from(jobRun).where(eq(jobRun.id, id));
    expect(row!.stats).toEqual({ lineups: { prompt_cuts: 2 }, exit_code: 0, duration_ms: 10 });
  });
});

describe('trava por job entre processos (advisory lock de sessão)', () => {
  const lock = (name: string) => tryJobLock(testUrl, name);
  const runs = async () => (await db.select().from(jobRun).where(eq(jobRun.job, 'live-run'))).length;

  it('a segunda execução simultânea do mesmo job é pulada sem registro; depois a trava fica livre', async () => {
    const recorder = new PgRunRecorder(db);
    const slow = { ...job('slow.mjs'), name: 'live-run' };
    const options = { cwd: dir, recorder, logger, lock };
    const before = await runs();

    const first = runJob(slow, { ...options, trigger: 'schedule' });
    await new Promise((r) => setTimeout(r, 300));
    // ex.: `scheduler --run live-run` no console com o ao vivo agendado no ar
    const second = await runJob(slow, { ...options, trigger: 'manual' });
    expect(second).toMatchObject({ status: 'skipped', runId: undefined, exitCode: null });
    // outro job não é afetado pela trava do ao vivo
    expect((await runJob(job('ok.mjs'), { ...options, trigger: 'manual' })).status).toBe('ok');
    expect((await first).status).toBe('ok');
    expect(await runs()).toBe(before + 1);

    // terminado o primeiro, o próximo horário da agenda roda normalmente
    expect(
      (await runJob({ ...job('ok.mjs'), name: 'live-run' }, { ...options, trigger: 'schedule' })).status,
    ).toBe('ok');
  });

  it('a trava não fica presa quando o processo que a segurava cai (a conexão some)', async () => {
    let lost = 0;
    const held = await tryJobLock(testUrl, 'crash-test', { onLost: () => (lost += 1) });
    expect(held).not.toBeNull();
    expect(await lock('crash-test')).toBeNull();
    // simula o crash: o Postgres derruba a sessão dona da trava
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and granted and database = (select oid from pg_database where datname = '${dbName}')`,
    );
    const again = await lock('crash-test');
    expect(again).not.toBeNull();
    // quem segurava fica sabendo que perdeu a trava (o scheduler loga um aviso)
    for (let i = 0; i < 50 && lost === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(lost).toBe(1);
    await again!.release();
    await held!.release().catch(() => {});
    // soltar normalmente não conta como perda
    expect(lost).toBe(1);
  });
});
