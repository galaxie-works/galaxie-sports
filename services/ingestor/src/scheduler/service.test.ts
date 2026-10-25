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
