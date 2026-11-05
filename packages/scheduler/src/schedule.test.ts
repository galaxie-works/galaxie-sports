import { describe, expect, it } from 'vitest';
import { assertCron, envKey, MINUTE, nextRuns, scheduleFromEnv, type ScheduledJob } from './schedule.js';

const JOBS: readonly ScheduledJob[] = [
  {
    name: 'sync-diario',
    description: '',
    cron: '5 0 * * *',
    script: 'dist/cli/a.js',
    args: [],
    timeoutMs: 30 * MINUTE,
  },
  {
    name: 'ao-vivo',
    description: '',
    cron: '*/5 * * * *',
    script: 'dist/cli/b.js',
    args: [],
    timeoutMs: 600 * MINUTE,
    ownTimeout: true,
  },
  {
    name: 'cota',
    description: '',
    cron: '5 * * * *',
    script: 'dist/cli/c.js',
    args: ['--x'],
    timeoutMs: 10 * MINUTE,
  },
];

describe('scheduleFromEnv', () => {
  it('sem sobrescritas devolve a agenda padrão', () => {
    expect(scheduleFromEnv({}, JOBS).map((j) => [j.name, j.cron])).toEqual([
      ['sync-diario', '5 0 * * *'],
      ['ao-vivo', '*/5 * * * *'],
      ['cota', '5 * * * *'],
    ]);
  });

  it('SCHEDULE_<JOB> troca o cron e "off" desliga o job', () => {
    const jobs = scheduleFromEnv({ SCHEDULE_COTA: '*/30 * * * *', SCHEDULE_SYNC_DIARIO: 'off' }, JOBS);
    expect(jobs.map((j) => [j.name, j.cron])).toEqual([
      ['ao-vivo', '*/5 * * * *'],
      ['cota', '*/30 * * * *'],
    ]);
  });

  it('SCHEDULER_TIMEOUT_MINUTES vale para os jobs, menos para os de tempo limite próprio (o ao vivo)', () => {
    const jobs = scheduleFromEnv({ SCHEDULER_TIMEOUT_MINUTES: '2' }, JOBS);
    expect(jobs.find((j) => j.name === 'cota')!.timeoutMs).toBe(2 * MINUTE);
    expect(jobs.find((j) => j.name === 'ao-vivo')!.timeoutMs).toBe(600 * MINUTE);
  });

  it('recusa cron inválido com mensagem legível', () => {
    expect(() => scheduleFromEnv({ SCHEDULE_COTA: 'toda hora' }, JOBS)).toThrow(
      /Agenda inválida para "cota"/,
    );
    expect(() => assertCron('* * * * *', 'x')).not.toThrow();
  });

  it('não altera a lista recebida', () => {
    scheduleFromEnv({ SCHEDULER_TIMEOUT_MINUTES: '2', SCHEDULE_COTA: 'off' }, JOBS);
    expect(JOBS).toHaveLength(3);
    expect(JOBS[2]!.timeoutMs).toBe(10 * MINUTE);
  });
});

describe('envKey e nextRuns', () => {
  it('o nome da variável sai do nome do job', () => {
    expect(envKey('bootstrap-catalog')).toBe('SCHEDULE_BOOTSTRAP_CATALOG');
  });

  it('as próximas execuções são em UTC', () => {
    const runs = nextRuns(JOBS[2]!, 2, new Date('2026-10-21T14:30:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-10-21T15:05:00.000Z',
      '2026-10-21T16:05:00.000Z',
    ]);
  });
});
