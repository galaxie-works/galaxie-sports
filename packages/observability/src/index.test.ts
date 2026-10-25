import { describe, expect, it } from 'vitest';
import { quotaPolicyFromEnv } from './index.js';

describe('quotaPolicyFromEnv', () => {
  it('usa o limite diário do plano de cada API', () => {
    const policyFor = quotaPolicyFromEnv({
      APISPORTS_PLAN: 'free',
      APISPORTS_PLAN_FOOTBALL: 'pro',
      QUOTA_RESERVE_PERCENT: '10',
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

  it('sem variáveis, todas as APIs no free com reserva de 15%', () => {
    expect(quotaPolicyFromEnv({})('football')).toMatchObject({ dailyLimit: 100, reservePercent: 15 });
  });
});
