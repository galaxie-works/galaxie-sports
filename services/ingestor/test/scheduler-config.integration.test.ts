import { jobRequest, runtimeEnv, writeRuntimeSetting, type Database } from '@galaxie/db';
import { createLogger } from '@galaxie/observability';
import { RUNTIME_BASE_ENV } from '@galaxie/runtime-config';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunResult } from '../src/scheduler/runner.js';
import { DEFAULT_JOBS, type ScheduledJob } from '../src/scheduler/schedule.js';
import { SchedulerService } from '../src/scheduler/service.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const logger = createLogger({ service: 'test', level: 'silent' });

beforeAll(async () => {
  db = await disposable.setup();
}, 60_000);
afterAll(() => disposable.teardown());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() - start > timeoutMs) return v;
    await sleep(50);
  }
}

const set = (key: string, value: string | null, valueType = 'cron') =>
  writeRuntimeSetting(db, { key, value, valueType, by: 'admin@teste.com' });

describe('scheduler relendo a configuração do painel', () => {
  const runs: { job: string; trigger: string; env: NodeJS.ProcessEnv }[] = [];
  const jobs: ScheduledJob[] = DEFAULT_JOBS.filter((j) =>
    ['quota-status', 'events-clock', 'sync-daily'].includes(j.name),
  );
  let service: SchedulerService;

  beforeAll(async () => {
    service = new SchedulerService({
      profile: 'ingestor',
      jobs,
      env: { SCHEDULE_QUOTA_STATUS: '7 * * * *', LIVE_FEATURED: 'off', APISPORTS_KEY: 'chave-secreta-xyz' },
      db,
      log: logger,
      refreshMs: 3_600_000, // os testes chamam refresh() na mão
      run: async (job, { trigger, env }): Promise<RunResult> => {
        runs.push({ job: job.name, trigger, env });
        await sleep(20);
        return {
          job: job.name,
          runId: undefined,
          status: 'ok',
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs: 20,
        };
      },
    });
    await service.start();
  });
  afterAll(() => {
    service?.stop();
  });

  it('parte da agenda do env do contêiner e relata o env (segredos só como configurado)', async () => {
    expect(service.activeCrons().map((c) => [c.job, c.cron])).toEqual([
      ['sync-daily', '5 0 * * *'],
      ['events-clock', '* * * * *'],
      ['quota-status', '7 * * * *'],
    ]);
    const env = await db.select().from(runtimeEnv).where(eq(runtimeEnv.service, 'ingestor'));
    expect(env.find((e) => e.key === 'LIVE_FEATURED')).toMatchObject({ value: 'off', configured: true });
    expect(env.find((e) => e.key === 'APISPORTS_KEY')).toMatchObject({ value: null, configured: true });
    expect(JSON.stringify(env)).not.toContain('chave-secreta-xyz');
  });

  it('reprograma sem reiniciar: agenda nova, job desligado e flag nova no env dos jobs', async () => {
    await set('SCHEDULE_QUOTA_STATUS', '*/10 * * * *');
    await set('SCHEDULE_EVENTS_CLOCK', 'off');
    await set('LIVE_FEATURED', 'on', 'enum');
    await service.refresh();

    const crons = service.activeCrons();
    expect(crons.map((c) => [c.job, c.cron])).toEqual([
      ['sync-daily', '5 0 * * *'],
      ['quota-status', '*/10 * * * *'],
    ]);
    const next = new Date(crons.find((c) => c.job === 'quota-status')!.next!);
    expect(next.getUTCMinutes() % 10).toBe(0);
    expect(service.effectiveEnv.LIVE_FEATURED).toBe('on');
    // o job sabe o valor original do contêiner (para "voltar ao padrão" no meio de um processo longo)
    expect(JSON.parse(service.effectiveEnv[RUNTIME_BASE_ENV]!)).toMatchObject({ LIVE_FEATURED: 'off' });
  });

  it('atende "rodar agora": job liberado roda com o env efetivo (mesmo desligado na agenda); o resto é recusado', async () => {
    await db.insert(jobRequest).values([
      { job: 'events-clock', requestedBy: 'admin@teste.com' },
      { job: 'sync-daily', requestedBy: 'admin@teste.com' },
    ]);
    await service.refresh();
    const rows = await until(
      () => db.select().from(jobRequest).orderBy(asc(jobRequest.job)),
      (r) => r.every((x) => x.status !== 'pending' && x.status !== 'running'),
    );
    expect(rows.map((r) => [r.job, r.status, r.detail])).toEqual([
      ['events-clock', 'done', null],
      ['sync-daily', 'skipped', 'not_allowed'],
    ]);
    // só os pedidos do painel: o events-clock (`* * * * *`) roda sozinho na virada de um minuto antes de
    // ser desligado no teste anterior, e essa execução agendada não é o que este teste mede
    const panel = runs.filter((r) => r.trigger === 'panel');
    expect(panel).toHaveLength(1);
    expect(panel[0]).toMatchObject({ job: 'events-clock', trigger: 'panel' });
    expect(panel[0]!.env.LIVE_FEATURED).toBe('on');
    expect(runs.some((r) => r.job === 'sync-daily')).toBe(false);
  });

  it('voltar ao padrão devolve a agenda do env do contêiner', async () => {
    await set('SCHEDULE_QUOTA_STATUS', null);
    await set('SCHEDULE_EVENTS_CLOCK', null);
    await set('LIVE_FEATURED', null, 'enum');
    await service.refresh();
    expect(service.activeCrons().map((c) => [c.job, c.cron])).toEqual([
      ['sync-daily', '5 0 * * *'],
      ['quota-status', '7 * * * *'],
      ['events-clock', '* * * * *'],
    ]);
    expect(service.effectiveEnv.LIVE_FEATURED).toBe('off');
    expect(service.effectiveEnv[RUNTIME_BASE_ENV]).toBeUndefined();
  });

  it('sobrescrita inválida gravada direto no banco é ignorada', async () => {
    await set('SCHEDULE_SYNC_DAILY', 'toda hora');
    await service.refresh();
    expect(service.activeCrons().find((c) => c.job === 'sync-daily')?.cron).toBe('5 0 * * *');
  });
});
