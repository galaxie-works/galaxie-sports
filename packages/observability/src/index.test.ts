import { describe, expect, it } from 'vitest';
import { quotaPolicyFromEnv } from './index.js';

describe('quotaPolicyFromEnv', () => {
  it('usa o limite diário do plano de cada API', () => {
    const policyFor = quotaPolicyFromEnv({
      APISPORTS_PLAN: 'free',
      APISPORTS_PLAN_FOOTBALL: 'pro',
      APP_ENV: 'staging',
      QUOTA_LIVE_RESERVE_PERCENT: '10',
    });
    expect(policyFor('football')).toMatchObject({ dailyLimit: 7500, reservePercent: 10 });
    expect(policyFor('basketball')).toMatchObject({ dailyLimit: 100, reservePercent: 10 });
    expect(policyFor('formula-1')).toMatchObject({ dailyLimit: 100 });
  });

  it('leva o limite por minuto do plano (com o teto de APISPORTS_PER_MINUTE) para o Governor', () => {
    const policyFor = quotaPolicyFromEnv({
      APISPORTS_PLAN_FOOTBALL: 'pro',
      APISPORTS_PER_MINUTE_FOOTBALL: '120',
    });
    expect(policyFor('football').perMinute).toBe(120);
    expect(policyFor('hockey').perMinute).toBe(10);
  });

  it('na produção (APP_ENV da VPS), reserva de 25% que só o ao vivo usa', () => {
    for (const APP_ENV of ['staging', 'production']) {
      expect(quotaPolicyFromEnv({ APP_ENV })('football')).toMatchObject({
        dailyLimit: 100,
        reservePercent: 25,
        liveUsesReserve: true,
      });
    }
    // a variável antiga (5% na VPS desde 23/10, quando a reserva barrava o ao vivo) não vale mais
    expect(
      quotaPolicyFromEnv({ APP_ENV: 'staging', QUOTA_RESERVE_PERCENT: '5' })('football').reservePercent,
    ).toBe(25);
  });

  it('no dev (sem APP_ENV), reserva de pelo menos 70% que vale até para o ao vivo', () => {
    expect(quotaPolicyFromEnv({})('football')).toMatchObject({ reservePercent: 70, liveUsesReserve: false });
    expect(quotaPolicyFromEnv({ QUOTA_LIVE_RESERVE_PERCENT: '40' })('football').reservePercent).toBe(70);
    expect(
      quotaPolicyFromEnv({ APP_ENV: 'development', QUOTA_LIVE_RESERVE_PERCENT: '80' })('football')
        .reservePercent,
    ).toBe(80);
  });
});
