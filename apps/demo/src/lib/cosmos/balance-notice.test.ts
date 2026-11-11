import { describe, expect, it } from 'vitest';

import { balanceNotice } from './data-utils';

const wallet = {
  tenantId: 't',
  available: 100,
  reserved: 0,
  receivedTotal: 100,
  status: 'active' as const,
  trialGranted: true,
  trialRemaining: 0,
  trialExpiresAt: null,
  cycleBase: 100,
  cycleStartedAt: null,
  alertLevel: 0,
  blockReason: null,
  enabled: true,
};

describe('aviso do saldo na Visão geral', () => {
  it('do mais grave ao mais leve', () => {
    expect(balanceNotice({ ...wallet, status: 'blocked', blockReason: 'staff' })).toBe('blocked');
    expect(balanceNotice({ ...wallet, status: 'blocked', blockReason: 'depleted', alertLevel: 100 })).toBe(
      'depleted',
    );
    expect(balanceNotice({ ...wallet, alertLevel: 90, trialRemaining: 5 })).toBe('low90');
    expect(balanceNotice({ ...wallet, alertLevel: 80 })).toBe('low80');
    expect(balanceNotice({ ...wallet, trialRemaining: 40 })).toBe('trial');
    expect(balanceNotice(wallet)).toBeNull();
  });
});
