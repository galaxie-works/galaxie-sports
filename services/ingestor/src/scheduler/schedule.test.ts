import { describe, expect, it } from 'vitest';
import { DEFAULT_JOBS, envKey, nextRuns, scheduleFromEnv } from './schedule.js';

describe('scheduleFromEnv', () => {
  it('usa a agenda padrão quando não há sobrescritas', () => {
    expect(scheduleFromEnv({}).map((j) => [j.name, j.cron])).toEqual(
      DEFAULT_JOBS.map((j) => [j.name, j.cron]),
    );
  });

  it('sobrescreve, desliga e ajusta o tempo limite pelo ambiente', () => {
    const jobs = scheduleFromEnv({
      SCHEDULE_QUOTA_STATUS: '*/30 * * * *',
      SCHEDULE_BOOTSTRAP_CATALOG: 'off',
      SCHEDULE_SYNC_DAILY: 'false',
      SCHEDULER_TIMEOUT_MINUTES: '2',
    });
    expect(jobs.map((j) => j.name)).toEqual([
      'live-run',
      'normalize-football',
      'events-clock',
      'assets-mirror',
      'assets-palette',
      'change-feed-prune',
      'quota-status',
    ]);
    expect(jobs.find((j) => j.name === 'quota-status')).toMatchObject({
      name: 'quota-status',
      cron: '*/30 * * * *',
      timeoutMs: 120_000,
    });
  });

  it('agenda o sync diário logo após a virada da cota (00:05 UTC) e o ao vivo a cada 5 min', () => {
    const jobs = scheduleFromEnv({});
    const daily = jobs.find((j) => j.name === 'sync-daily')!;
    expect(daily.cron).toBe('5 0 * * *');
    expect(nextRuns(daily, 1, new Date('2026-10-21T23:59:00Z'))[0]!.toISOString()).toBe(
      '2026-10-22T00:05:00.000Z',
    );
    const live = jobs.find((j) => j.name === 'live-run')!;
    expect(live).toMatchObject({ cron: '*/5 * * * *', script: 'dist/cli/live-run.js' });
    expect(live.timeoutMs).toBeGreaterThanOrEqual(12 * 3_600_000);
  });

  it('recusa expressão cron inválida com mensagem legível', () => {
    expect(() => scheduleFromEnv({ SCHEDULE_QUOTA_STATUS: 'toda hora' })).toThrow(
      /Agenda inválida para "quota-status"/,
    );
  });

  it('nome da variável e próximas execuções em UTC', () => {
    expect(envKey('bootstrap-catalog')).toBe('SCHEDULE_BOOTSTRAP_CATALOG');
    const job = scheduleFromEnv({ SCHEDULE_QUOTA_STATUS: '5 * * * *' }).find(
      (j) => j.name === 'quota-status',
    );
    const runs = nextRuns(job!, 2, new Date('2026-10-21T14:30:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-10-21T15:05:00.000Z',
      '2026-10-21T16:05:00.000Z',
    ]);
  });
});
