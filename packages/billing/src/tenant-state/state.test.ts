import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isTenantState,
  STATES_WITHOUT_ACCESS,
  stateHasAccess,
  TENANT_STATES,
  TENANT_STATES_WITH_WEBHOOKS,
  TENANT_TRANSITIONS,
  type TenantState,
} from './state.js';

describe('máquina de estados do tenant (doc 02)', () => {
  it('os 9 estados, e cada um tem uma linha na tabela de transições', () => {
    expect(TENANT_STATES).toEqual([
      'draft',
      'pending_review',
      'rejected',
      'trial',
      'trial_expired',
      'active',
      'past_due',
      'suspended',
      'cancelled',
    ]);
    expect(Object.keys(TENANT_TRANSITIONS).sort()).toEqual([...TENANT_STATES].sort());
    for (const targets of Object.values(TENANT_TRANSITIONS))
      for (const t of targets) expect(isTenantState(t)).toBe(true);
  });

  it('o diagrama: cadastro, revisão, trial, pagamento, inadimplência, suspensão e cancelamento', () => {
    const ok: [TenantState, TenantState][] = [
      ['draft', 'pending_review'],
      ['draft', 'trial'],
      ['draft', 'active'],
      ['pending_review', 'trial'],
      ['pending_review', 'rejected'],
      ['trial', 'active'],
      ['trial', 'trial_expired'],
      ['trial', 'suspended'],
      ['trial', 'cancelled'],
      ['trial_expired', 'active'],
      ['trial_expired', 'cancelled'],
      ['active', 'past_due'],
      ['active', 'suspended'],
      ['active', 'cancelled'],
      ['past_due', 'active'],
      ['past_due', 'suspended'],
      ['past_due', 'cancelled'],
      ['suspended', 'active'],
      ['suspended', 'cancelled'],
    ];
    for (const [from, to] of ok) expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
  });

  it('o que não existe: estados finais, voltar ao draft, pular a revisão, mesmo estado', () => {
    const no: [TenantState, TenantState][] = [
      ['rejected', 'trial'],
      ['cancelled', 'active'],
      ['trial', 'draft'],
      ['active', 'trial'],
      ['trial_expired', 'trial'],
      ['pending_review', 'active'],
      ['active', 'active'],
      ['suspended', 'past_due'],
    ];
    for (const [from, to] of no) expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
    expect(canTransition('x' as TenantState, 'trial')).toBe(false);
  });

  it('acesso: só trial, active e past_due passam na API', () => {
    expect(STATES_WITHOUT_ACCESS).toEqual([
      'draft',
      'pending_review',
      'rejected',
      'trial_expired',
      'suspended',
      'cancelled',
    ]);
    expect(TENANT_STATES.filter(stateHasAccess)).toEqual(['trial', 'active', 'past_due']);
  });

  it('webhooks: só active e past_due (o trial tem SSE, não webhooks: doc 02)', () => {
    expect(TENANT_STATES_WITH_WEBHOOKS).toEqual(['active', 'past_due']);
  });

  it('isTenantState', () => {
    expect(isTenantState('trial')).toBe(true);
    expect(isTenantState('ativo')).toBe(false);
    expect(isTenantState(1)).toBe(false);
  });
});
