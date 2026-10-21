import { defaultPolicy } from '@galaxie/apisports-client';
import { describe, expect, it } from 'vitest';
import { computeQuotaStates } from './quota.js';

const policy = () => defaultPolicy(100, 15);
const day = '2026-10-21';

describe('computeQuotaStates', () => {
  it('soma todas as linhas do dia (inclusive pendentes e erros) por prioridade e ignora outros dias', () => {
    const [football] = computeQuotaStates(
      ['football'],
      day,
      policy,
      [
        { api: 'football', dayUtc: day, priority: 'DAILY', outcome: 'ok', calls: 30 },
        { api: 'football', dayUtc: day, priority: 'DAILY', outcome: 'plan_error', calls: 2 },
        { api: 'football', dayUtc: day, priority: 'LIVE', outcome: 'pending', calls: 1 },
        { api: 'football', dayUtc: '2026-10-20', priority: 'DAILY', outcome: 'ok', calls: 99 },
        { api: 'basketball', dayUtc: day, priority: 'DAILY', outcome: 'ok', calls: 7 },
      ],
      [],
      [],
    );
    expect(football!.used).toMatchObject({ DAILY: 32, LIVE: 1, BOOTSTRAP: 0, ADHOC: 0 });
    expect(football!.effectiveUsed).toBe(33);
    expect(football!.remaining).toBe(67);
    expect(football!.remainingRatio).toBeCloseTo(0.67);
    expect(football!.reserve).toBe(15);
    expect(football!.budget).toMatchObject({ DAILY: 40, LIVE: 40, ADHOC: 5, BOOTSTRAP: 0 });
  });

  it('não soma ledger e fornecedor: usa o maior dos dois como uso efetivo', () => {
    const [state] = computeQuotaStates(
      ['football'],
      day,
      policy,
      [{ api: 'football', dayUtc: day, priority: 'DAILY', outcome: 'ok', calls: 10 }],
      [{ api: 'football', providerUsed: 25, providerLimit: 100, plan: 'Free' }],
      [],
    );
    expect(state!.totalUsed).toBe(10);
    expect(state!.providerUsed).toBe(25);
    expect(state!.effectiveUsed).toBe(25);
    expect(state!.remaining).toBe(75);
  });

  it('usa o limite menor do fornecedor e o plano do dia', () => {
    const [state] = computeQuotaStates(
      ['football'],
      day,
      () => defaultPolicy(7500, 15),
      [],
      [{ api: 'football', providerUsed: 0, providerLimit: 100, plan: 'Free' }],
      [{ api: 'football', priority: 'LIVE', planned: 0 }],
    );
    expect(state!.dailyLimit).toBe(100);
    expect(state!.budget.LIVE).toBe(0);
    expect(state!.budget.DAILY).toBe(40);
  });

  it('reporta APIs sem uso com a cota inteira', () => {
    const states = computeQuotaStates(['mma', 'rugby'], day, policy, [], [], []);
    expect(states.map((s) => [s.api, s.remainingRatio])).toEqual([
      ['mma', 1],
      ['rugby', 1],
    ]);
  });
});
