import { describe, expect, it } from 'vitest';
import { aiBudget, effectiveOpsSettings, expectedIntervalSeconds, jobExpectations } from './ops.js';

const now = new Date('2026-10-28T12:00:00Z');

describe('expectedIntervalSeconds', () => {
  it('maior intervalo entre as próximas execuções', () => {
    expect(expectedIntervalSeconds('*/5 * * * *', now)).toBe(300);
    expect(expectedIntervalSeconds('40 5,17 * * *', now)).toBe(12 * 3600);
    expect(expectedIntervalSeconds('15 3 * * 1', now)).toBe(7 * 86_400);
  });

  it('agenda desligada ou inválida não tem intervalo', () => {
    expect(expectedIntervalSeconds('off', now)).toBeNull();
    expect(expectedIntervalSeconds('not a cron', now)).toBeNull();
    expect(expectedIntervalSeconds(null, now)).toBeNull();
  });
});

describe('effectiveOpsSettings', () => {
  it('banco > env relatado pelo serviço do job > padrão', () => {
    const settings = effectiveOpsSettings(new Map([['SCHEDULE_RELATED_RUN', '*/20 * * * *']]), [
      { service: 'agents', key: 'SCHEDULE_RELATED_RUN', value: '*/7 * * * *' },
      { service: 'ingestor', key: 'SCHEDULE_LIVE_RUN', value: '*/2 * * * *' },
      // relatado por outro serviço: não vale para o job do ingestor
      { service: 'agents', key: 'SCHEDULE_QUOTA_STATUS', value: '*/1 * * * *' },
    ]);
    expect(settings.get('SCHEDULE_RELATED_RUN')).toBe('*/20 * * * *');
    expect(settings.get('SCHEDULE_LIVE_RUN')).toBe('*/2 * * * *');
    expect(settings.get('SCHEDULE_QUOTA_STATUS')).toBe('5 * * * *');
  });

  it('sobrescrita inválida do banco é ignorada', () => {
    const settings = effectiveOpsSettings(new Map([['SCHEDULE_LIVE_RUN', 'a cada 5 min']]), []);
    expect(settings.get('SCHEDULE_LIVE_RUN')).toBe('*/5 * * * *');
  });
});

describe('jobExpectations', () => {
  it('só jobs ligados, com o serviço de cada um', () => {
    const jobs = jobExpectations(effectiveOpsSettings(new Map([['SCHEDULE_WTW_RUN', 'off']]), []), now);
    expect(jobs.find((j) => j.job === 'wtw-run')).toBeUndefined();
    expect(jobs.find((j) => j.job === 'live-run')).toEqual({
      job: 'live-run',
      service: 'ingestor',
      intervalSeconds: 300,
    });
    expect(jobs.find((j) => j.job === 'recap-run')?.service).toBe('agents');
  });
});

describe('aiBudget', () => {
  it('teto efetivo e dia de orçamento (virada às 06:00 de Brasília por padrão)', () => {
    const s = effectiveOpsSettings(new Map([['AI_DAILY_USD_BUDGET', '25']]), []);
    expect(aiBudget(s, new Date('2026-10-28T08:59:00Z'))).toEqual({ dailyUsd: 25, budgetDay: '2026-10-27' });
    expect(aiBudget(s, new Date('2026-10-28T09:00:00Z')).budgetDay).toBe('2026-10-28');
  });

  it('padrão do código e unlimited', () => {
    expect(aiBudget(effectiveOpsSettings(new Map(), []), now).dailyUsd).toBe(10);
    const unlimited = effectiveOpsSettings(new Map([['AI_DAILY_USD_BUDGET', 'unlimited']]), []);
    expect(aiBudget(unlimited, now).dailyUsd).toBeNull();
  });

  it('virada e fuso relatados pelos agentes', () => {
    const s = effectiveOpsSettings(new Map(), [
      { service: 'agents', key: 'AI_BUDGET_TIMEZONE', value: 'UTC' },
      { service: 'agents', key: 'AI_BUDGET_DAY_START', value: '00:00' },
    ]);
    expect(aiBudget(s, new Date('2026-10-28T00:30:00Z')).budgetDay).toBe('2026-10-28');
  });
});
