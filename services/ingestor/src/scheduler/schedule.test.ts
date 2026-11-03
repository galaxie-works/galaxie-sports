import { planByName } from '@galaxie/apisports-client';
import {
  API_PLAN_DAILY_LIMITS,
  API_PLANS,
  SCHEDULED_JOBS,
  scheduleKey,
  settingDef,
} from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_OPTIONS } from '../live/schedule.js';
import { DEFAULT_CHANGE_FEED_RETENTION_DAYS } from '../ops/change-feed-retention.js';
import { envKey, nextRuns, scheduleFromEnv as scheduleJobs } from '@galaxie/scheduler';
import { DEFAULT_JOBS } from './schedule.js';

/** A agenda do ingestor com as sobrescritas do ambiente. */
const scheduleFromEnv = (env: NodeJS.ProcessEnv) => scheduleJobs(env, DEFAULT_JOBS);

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
      'postgame-close',
      'live-reconcile',
      'normalize-football',
      'normalize-sports',
      'events-clock',
      'events-importance',
      'assets-mirror',
      'assets-palette',
      'change-feed-prune',
      'data-retention',
      'fixture-people',
      'quota-status',
      'data-quality',
    ]);
    expect(jobs.find((j) => j.name === 'quota-status')).toMatchObject({
      name: 'quota-status',
      cron: '*/30 * * * *',
      timeoutMs: 120_000,
    });
  });

  it('SCHEDULER_TIMEOUT_MINUTES não encurta o ao vivo, que tem tempo limite próprio', () => {
    const jobs = scheduleFromEnv({ SCHEDULER_TIMEOUT_MINUTES: '60' });
    expect(jobs.find((j) => j.name === 'live-run')!.timeoutMs).toBe(20 * 3_600_000);
    expect(jobs.find((j) => j.name === 'live-reconcile')!.timeoutMs).toBe(3_600_000);
  });

  it('reconciliação do ao vivo: a agenda confere só os parados; sob demanda (painel) força todos', () => {
    const job = scheduleFromEnv({}).find((j) => j.name === 'live-reconcile')!;
    expect(job).toMatchObject({ cron: '*/10 * * * *', args: [], onDemandArgs: ['--forcar'] });
  });

  it('agenda o sync diário logo após a virada da cota (00:05 UTC) e o ao vivo a cada 5 min', () => {
    const jobs = scheduleFromEnv({});
    const daily = jobs.find((j) => j.name === 'sync-daily')!;
    expect(daily.cron).toBe('5 0 * * *');
    expect(daily.args).toContain('--outros-esportes');
    expect(nextRuns(daily, 1, new Date('2026-10-21T23:59:00Z'))[0]!.toISOString()).toBe(
      '2026-10-22T00:05:00.000Z',
    );
    const live = jobs.find((j) => j.name === 'live-run')!;
    expect(live).toMatchObject({ cron: '*/5 * * * *', script: 'dist/cli/live-run.js' });
    expect(live.timeoutMs).toBeGreaterThanOrEqual(12 * 3_600_000);
  });

  it('recalcula a importância (sinais da tabela) de hora em hora para os próximos 7 dias', () => {
    const job = scheduleFromEnv({}).find((j) => j.name === 'events-importance')!;
    expect(job).toMatchObject({
      cron: '20 * * * *',
      script: 'dist/cli/events-importance.js',
      args: ['--esporte', 'football', '--proximos-dias', '7'],
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

describe('registro do painel de Operação (@galaxie/runtime-config)', () => {
  it('cada job do ingestor tem a mesma agenda padrão e o mesmo perfil no registro', () => {
    const fromCode = DEFAULT_JOBS.map((j) => ({ name: j.name, service: 'ingestor', cron: j.cron }));
    expect(
      SCHEDULED_JOBS.filter((j) => j.service === 'ingestor').map(({ name, service, cron }) => ({
        name,
        service,
        cron,
      })),
    ).toEqual(fromCode);
    for (const j of fromCode) expect(scheduleKey(j.name)).toBe(envKey(j.name));
  });

  it('padrões do ao vivo e da retenção batem com o código', () => {
    expect(settingDef('LIVE_MAX_INTERVAL_MINUTES')?.default).toBe(
      String(DEFAULT_LIVE_OPTIONS.maxIntervalMs / 60_000),
    );
    expect(settingDef('CHANGE_FEED_RETENTION_DAYS')?.default).toBe(
      String(DEFAULT_CHANGE_FEED_RETENTION_DAYS),
    );
  });

  it('planos da api-sports e a cota diária de cada um', () => {
    for (const plan of API_PLANS) expect(API_PLAN_DAILY_LIMITS[plan]).toBe(planByName(plan).dailyLimit);
  });
});
