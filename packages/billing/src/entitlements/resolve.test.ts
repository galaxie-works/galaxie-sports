import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog/catalog.js';
import { resolveEntitlements, type EntitlementInputs, type OverrideRow, type TenantRow } from './resolve.js';

const catalog = loadCatalog();
const now = new Date('2026-11-12T12:00:00Z');
const later = new Date('2026-12-31T00:00:00Z');
const past = new Date('2026-11-01T00:00:00Z');

const tenantRow = (over: Partial<TenantRow> = {}): TenantRow => ({
  id: '00000000-0000-7000-8000-000000000001',
  plan: 'fan_experience',
  modules: ['core_data', 'where_to_watch', 'semantic'],
  markets: [],
  sports: [],
  rateLimitPerMinute: 300,
  dailyRequestQuota: 500_000,
  trialEndsAt: null,
  status: 'active',
  catalogVersion: null,
  capacityTier: null,
  ...over,
});

const inputs = (over: Partial<EntitlementInputs> = {}): EntitlementInputs => ({
  tenant: tenantRow(),
  moduleLimits: [],
  overrides: [],
  wallet: null,
  ...over,
});

const override = (o: Partial<OverrideRow> & Pick<OverrideRow, 'kind' | 'key'>): OverrideRow => ({
  value: null,
  validUntil: later,
  revokedAt: null,
  ...o,
});

describe('resolveEntitlements', () => {
  it('plano Fan Experience: módulos do tenant, features do plano e faixa de países do plano', () => {
    const e = resolveEntitlements(catalog, inputs(), { now });
    expect(e.state).toBe('active');
    expect(e.modules).toEqual(['core_data', 'semantic', 'where_to_watch']);
    expect(e.features).toContain('realtime.sse');
    expect(e.features).toContain('where_to_watch.rest');
    expect(e.tiers).toEqual({ 'where_to_watch.markets': 3 });
    expect(e.capacity.tier).toBe('C1');
    expect(e.catalogVersion).toBe(catalog.version);
    expect(e.warnings).toEqual([]);
  });

  it('trial sem tempo real; trial vencido e suspenso ficam sem nenhum módulo', () => {
    const trial = tenantRow({ plan: 'trial', modules: ['core_data'], trialEndsAt: later });
    const e = resolveEntitlements(catalog, inputs({ tenant: trial }), { now });
    expect(e.state).toBe('trial');
    expect(e.features).not.toContain('realtime.sse');

    const expired = resolveEntitlements(catalog, inputs({ tenant: { ...trial, trialEndsAt: past } }), {
      now,
    });
    expect(expired.state).toBe('trial_expired');
    expect(expired.modules).toEqual([]);
    expect(expired.features).toEqual([]);

    const suspended = resolveEntitlements(catalog, inputs({ tenant: tenantRow({ status: 'suspended' }) }), {
      now,
    });
    expect(suspended.state).toBe('suspended');
    expect(suspended.modules).toEqual([]);
  });

  it('exceções: concede e retira módulo, fixa faixa e soma add-on; vencida ou revogada não vale', () => {
    const e = resolveEntitlements(
      catalog,
      inputs({
        overrides: [
          override({ kind: 'module_grant', key: 'live_chat' }),
          override({ kind: 'module_revoke', key: 'semantic' }),
          override({ kind: 'tier', key: 'live_chat.peak_connections', value: 100_000 }),
          override({ kind: 'addon', key: 'where_to_watch.extra_markets', value: 2 }),
          override({ kind: 'module_grant', key: 'communities', validUntil: past }),
          override({ kind: 'module_grant', key: 'gamification', revokedAt: past }),
        ],
      }),
      { now },
    );
    expect(e.modules).toEqual(['core_data', 'live_chat', 'where_to_watch']);
    expect(e.tiers['live_chat.peak_connections']).toBe(100_000);
    expect(e.addons).toEqual({ 'where_to_watch.extra_markets': 2 });
    // add-on recorrente soma na faixa: 3 do plano + 2
    expect(e.tiers['where_to_watch.markets']).toBe(5);
  });

  it('faixa escolhida pelo tenant vale dentro do aceito; fora dele, fica o padrão e um aviso', () => {
    const tenant = tenantRow({ modules: ['core_data', 'where_to_watch', 'semantic', 'live_chat'] });
    const ok = resolveEntitlements(
      catalog,
      inputs({ tenant, moduleLimits: [{ key: 'live_chat.peak_connections', value: 25_000 }] }),
      { now },
    );
    expect(ok.tiers['live_chat.peak_connections']).toBe(25_000);
    const bad = resolveEntitlements(
      catalog,
      inputs({ tenant, moduleLimits: [{ key: 'live_chat.peak_connections', value: 7_000 }] }),
      { now },
    );
    expect(bad.tiers['live_chat.peak_connections']).toBe(5_000);
    expect(bad.warnings).toContain('faixa do tenant fora do aceito: live_chat.peak_connections = 7000');
  });

  it('dependência que falta vira aviso (a recusa fica com quem contrata, não com a leitura)', () => {
    const e = resolveEntitlements(
      catalog,
      inputs({ tenant: tenantRow({ plan: 'core_data', modules: ['core_data', 'live_chat'] }) }),
      { now },
    );
    expect(e.modules).toContain('live_chat');
    expect(e.warnings).toContain('módulo live_chat sem o que o catálogo exige (plano core_data)');
  });

  it('feature com dependência: moderação da Cosmos só com chat ou comunidades', () => {
    const only = resolveEntitlements(
      catalog,
      inputs({ tenant: tenantRow({ modules: ['core_data', 'cosmos_ai'] }) }),
      { now },
    );
    expect(only.features).toContain('cosmos_ai.assistant');
    expect(only.features).not.toContain('cosmos_ai.moderation');
    const withChat = resolveEntitlements(
      catalog,
      inputs({ tenant: tenantRow({ modules: ['core_data', 'cosmos_ai', 'live_chat'] }) }),
      { now },
    );
    expect(withChat.features).toContain('cosmos_ai.moderation');
  });

  it('exceção com chave desconhecida não liga nada e avisa', () => {
    const e = resolveEntitlements(
      catalog,
      inputs({ overrides: [override({ kind: 'module_grant', key: 'nope' })] }),
      {
        now,
      },
    );
    expect(e.modules).not.toContain('nope');
    expect(e.warnings).toContain('exceção module_grant com módulo desconhecido: nope');
  });

  it('capacidade do tenant, Galaxie, créditos e versão estável', () => {
    const a = resolveEntitlements(
      catalog,
      inputs({ tenant: tenantRow({ capacityTier: 'C2' }), wallet: { available: 250, status: 'active' } }),
      { now, galaxieTenantIds: ['00000000-0000-7000-8000-000000000001'] },
    );
    expect(a.capacity).toEqual({
      tier: 'C2',
      viewsPerMonth: 10_000_000,
      peakConcurrent: 50_000,
      chatWriters: 10_000,
    });
    expect(a.isGalaxie).toBe(true);
    expect(a.credits).toEqual({ available: 250, status: 'active' });
    const b = resolveEntitlements(
      catalog,
      inputs({ tenant: tenantRow({ capacityTier: 'C2' }), wallet: { available: 250, status: 'active' } }),
      { now, galaxieTenantIds: ['00000000-0000-7000-8000-000000000001'] },
    );
    expect(b.version).toBe(a.version);
    const c = resolveEntitlements(catalog, inputs({ tenant: tenantRow({ capacityTier: 'C3' }) }), { now });
    expect(c.version).not.toBe(a.version);
  });
});
