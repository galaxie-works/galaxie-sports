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
      'normalize-football',
      'events-clock',
      'assets-mirror',
      'quota-status',
    ]);
    expect(jobs.find((j) => j.name === 'quota-status')).toMatchObject({
      name: 'quota-status',
      cron: '*/30 * * * *',
      timeoutMs: 120_000,
    });
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
