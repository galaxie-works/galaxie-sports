import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sectionsForState } from '@/components/client/client-nav';

/*
 * P2 da revisão do #1299: entre o fim do trial e a rodada diária do `tenant.lifecycle`, a coluna ainda diz `trial`, mas a
 * API já responde TRIAL_EXPIRED. O `TenantInfo` usa o mesmo fallback (`effectiveState`), para a moldura, o menu e a ação
 * da loja verem `trial_expired`.
 */

const query = vi.fn();
vi.mock('@/lib/auth/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const { getTenantInfo } = await import('./tenants');

const T = '01a16029-0000-7000-8000-000000000001';
const row = (over: Record<string, unknown>) => ({
  id: T,
  slug: 'marca',
  name: 'Marca',
  status: 'active',
  plan: 'fan_experience',
  modules: ['core_data', 'where_to_watch', 'semantic'],
  markets: [],
  sports: [],
  rateLimitPerMinute: 300,
  dailyRequestQuota: 500000,
  organizationId: null,
  organizationName: null,
  isGalaxie: false,
  state: 'trial',
  stateSince: '2026-10-17T12:00:00Z',
  trialEndsAt: '2026-11-16T12:00:00Z',
  ...over,
});

beforeEach(() => query.mockReset());

describe('getTenantInfo: estado efetivo', () => {
  it('trial com o prazo vencido vale como trial_expired: menu restrito a Planos e módulos e Chaves', async () => {
    query.mockResolvedValue({ rows: [row({ trialEndsAt: '2000-01-01T00:00:00Z' })] });
    const info = (await getTenantInfo(T))!;
    expect(info.state).toBe('trial_expired');
    expect([...sectionsForState(info.state)!].sort()).toEqual(['keys', 'plans']);
  });

  it('trial dentro do prazo segue trial, com o menu inteiro; active com trial_ends_at antigo segue active', async () => {
    query.mockResolvedValue({ rows: [row({ trialEndsAt: '2999-01-01T00:00:00Z' })] });
    const trial = (await getTenantInfo(T))!;
    expect(trial.state).toBe('trial');
    expect(sectionsForState(trial.state)).toBeNull();
    query.mockResolvedValue({ rows: [row({ state: 'active', trialEndsAt: '2000-01-01T00:00:00Z' })] });
    expect((await getTenantInfo(T))!.state).toBe('active');
  });

  it('id que não é UUID e tenant inexistente: null', async () => {
    expect(await getTenantInfo('nope')).toBeNull();
    query.mockResolvedValue({ rows: [] });
    expect(await getTenantInfo(T)).toBeNull();
  });
});
