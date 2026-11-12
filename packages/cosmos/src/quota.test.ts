import { describe, expect, it } from 'vitest';

import { isQuotaScope, parseQuotas, quotaCredits, quotaFor, QUOTAS_MAX, raisedQuotas } from './quota.js';

describe('cotas por sala (#1116)', () => {
  it('aceita produto e sala; recusa o resto', () => {
    expect(isQuotaScope('chat')).toBe(true);
    expect(isQuotaScope('community:abc-1')).toBe(true);
    expect(isQuotaScope('pool:r.1')).toBe(true);
    expect(isQuotaScope('shop')).toBe(false);
    expect(isQuotaScope('chat:')).toBe(false);
    expect(isQuotaScope("chat:a'b")).toBe(false);
    expect(isQuotaScope(`chat:${'a'.repeat(121)}`)).toBe(false);
  });

  it('parseQuotas valida % e repetição e arredonda em duas casas', () => {
    expect(parseQuotas([{ scope: 'chat', percent: 12.345 }])).toEqual([{ scope: 'chat', percent: 12.35 }]);
    expect(parseQuotas([])).toEqual([]);
    expect(parseQuotas([{ scope: 'chat', percent: 0 }])).toBeNull();
    expect(parseQuotas([{ scope: 'chat', percent: 100.01 }])).toBeNull();
    expect(parseQuotas([{ scope: 'chat', percent: Number.NaN }])).toBeNull();
    expect(parseQuotas([{ scope: 'chat', percent: '10' }])).toBeNull();
    expect(
      parseQuotas([
        { scope: 'chat', percent: 10 },
        { scope: 'chat', percent: 20 },
      ]),
    ).toBeNull();
    expect(
      parseQuotas(Array.from({ length: QUOTAS_MAX + 1 }, (_, i) => ({ scope: `chat:r${i}`, percent: 1 }))),
    ).toBeNull();
    expect(parseQuotas('chat')).toBeNull();
  });

  it('quotaFor prefere a sala ao produto', () => {
    const quotas = [
      { scope: 'chat', percent: 30 },
      { scope: 'chat:r1', percent: 5 },
    ];
    expect(quotaFor('chat:r1', quotas)?.percent).toBe(5);
    expect(quotaFor('chat:r2', quotas)?.percent).toBe(30);
    expect(quotaFor('chat', quotas)?.percent).toBe(30);
    expect(quotaFor('pool', quotas)).toBeNull();
    expect(quotaFor(null, quotas)).toBeNull();
  });

  it('quotaCredits aplica a % sobre o saldo do ciclo', () => {
    expect(quotaCredits(10, 1000)).toBe(100);
    expect(quotaCredits(0.5, 0)).toBe(0);
  });
});

describe('aumentar a cota ao aprovar (#1116)', () => {
  it('parte da cota que vale hoje para a sala, nunca diminui', () => {
    const quotas = [{ scope: 'chat', percent: 30 }];
    expect(raisedQuotas(quotas, 'chat:r1', 5)).toEqual([
      { scope: 'chat', percent: 30 },
      { scope: 'chat:r1', percent: 35 },
    ]);
    expect(raisedQuotas([{ scope: 'pool', percent: 98 }], 'pool', 5)).toEqual([
      { scope: 'pool', percent: 100 },
    ]);
    expect(raisedQuotas([], 'community:c1', 2)).toEqual([{ scope: 'community:c1', percent: 2 }]);
    expect(raisedQuotas([], 'shop', 2)).toBeNull();
    expect(raisedQuotas([], 'chat', 0)).toBeNull();
  });

  it('% que o arredondamento zera é recusada', () => {
    expect(parseQuotas([{ scope: 'chat', percent: 0.004 }])).toBeNull();
  });
});
