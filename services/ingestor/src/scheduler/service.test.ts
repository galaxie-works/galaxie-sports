import { createLogger } from '@galaxie/observability';
import { describe, expect, it } from 'vitest';
import type { RunResult, RunTrigger } from './runner.js';
import { DEFAULT_JOBS, type ScheduledJob } from './schedule.js';
import { SchedulerService } from './service.js';

const logger = createLogger({ service: 'test', level: 'silent' });

function service() {
  const runs: { job: string; args: string[]; trigger: RunTrigger }[] = [];
  const s = new SchedulerService({
    profile: 'ingestor',
    jobs: DEFAULT_JOBS,
    env: {},
    log: logger,
    run: async (job: ScheduledJob, { trigger }): Promise<RunResult> => {
      runs.push({ job: job.name, args: job.args, trigger });
      return {
        job: job.name,
        runId: undefined,
        status: 'ok',
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 0,
      };
    },
  });
  return { s, runs };
}

describe('SchedulerService.execute', () => {
  it('reconciliação do ao vivo: a agenda confere só os parados; painel e --run forçam todos', async () => {
    const { s, runs } = service();
    await s.execute('live-reconcile', 'schedule');
    await s.execute('live-reconcile', 'start');
    await s.execute('live-reconcile', 'panel');
    await s.execute('live-reconcile', 'manual');
    expect(runs.map((r) => [r.trigger, r.args])).toEqual([
      ['schedule', []],
      ['start', []],
      ['panel', ['--forcar']],
      ['manual', ['--forcar']],
    ]);
  });

  it('jobs sem args próprios para "sob demanda" rodam igual pela agenda e pelo painel', async () => {
    const { s, runs } = service();
    await s.execute('events-importance', 'panel');
    expect(runs[0]!.args).toEqual(DEFAULT_JOBS.find((j) => j.name === 'events-importance')!.args);
  });
});

describe('SchedulerService: teto de jobs simultâneos', () => {
  const ok = (job: string): RunResult => ({
    job,
    runId: undefined,
    status: 'ok',
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 0,
  });

  function blocking(maxJobs: number) {
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const s = new SchedulerService({
      profile: 'ingestor',
      jobs: DEFAULT_JOBS,
      env: {},
      log: logger,
      maxJobs,
      run: (job) =>
        new Promise<RunResult>((resolve) => {
          started.push(job.name);
          finish.set(job.name, () => resolve(ok(job.name)));
        }),
    });
    return { s, started, finish };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('o excedente espera vaga; a faixa do ao vivo nunca espera', async () => {
    const { s, started, finish } = blocking(1);
    const sync = s.execute('sync-daily', 'schedule');
    const norm = s.execute('normalize-football', 'schedule');
    const live = s.execute('live-run', 'schedule');
    const clock = s.execute('events-clock', 'schedule');
    await tick();
    expect([...started].sort()).toEqual(['events-clock', 'live-run', 'sync-daily']);
    // na fila conta como em andamento: o cron seguinte do mesmo job pula
    expect(s.isRunning('normalize-football')).toBe(true);
    finish.get('sync-daily')!();
    await sync;
    await tick();
    expect(started).toContain('normalize-football');
    for (const name of ['normalize-football', 'live-run', 'events-clock']) finish.get(name)!();
    await Promise.all([norm, live, clock]);
  });

  it('no encerramento, quem esperava vaga não roda', async () => {
    const { s, started, finish } = blocking(1);
    const sync = s.execute('sync-daily', 'schedule');
    const norm = s.execute('normalize-football', 'schedule');
    await tick();
    s.stop();
    await expect(norm).resolves.toMatchObject({ status: 'skipped' });
    finish.get('sync-daily')!();
    await sync;
    expect(started).toEqual(['sync-daily']);
  });
});
