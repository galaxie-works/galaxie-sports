import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog/catalog.js';
import {
  minQuota,
  resolveEntitlements,
  type EntitlementInputs,
  type OverrideRow,
  type TenantRow,
} from './resolve.js';

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
  state: 'active',
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

let seq = 0;
const override = (o: Partial<OverrideRow> & Pick<OverrideRow, 'kind' | 'key'>): OverrideRow => ({
  id: `00000000-0000-7000-8000-${String(++seq).padStart(12, '0')}`,
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, seq)),
  value: null,
  validUntil: later,
  revokedAt: null,
  ...o,
});

describe('resolveEntitlements', () => {
  it('plano Fan Experience: módulos do tenant, features do plano e faixa de países do plano', () => {
    const e = resolveEntitlements(catalog, inputs(), { now });
    expect(e.state).toBe('active');
    expect(e.organizationId).toBeNull();
    expect(
      resolveEntitlements(catalog, inputs({ tenant: tenantRow({ organizationId: 'org-1' }) }), { now })
        .organizationId,
    ).toBe('org-1');
    expect(e.modules).toEqual(['core_data', 'semantic', 'where_to_watch']);
    expect(e.features).toContain('realtime.sse');
    expect(e.features).toContain('where_to_watch.rest');
    expect(e.tiers).toEqual({ 'core_data.sse_connections': 100, 'where_to_watch.markets': 3 });
    expect(e.limits).toEqual({ rateLimitPerMinute: 300, dailyRequestQuota: 500_000 });
    expect(e.moduleTrials).toEqual({});
    expect(e.capacity.tier).toBe('C1');
    expect(e.catalogVersion).toBe(catalog.version);
    expect(e.warnings).toEqual([]);
  });

  it('trial sem tempo real; trial vencido (coluna ou prazo) e suspenso ficam sem nenhum módulo', () => {
    const trial = tenantRow({ plan: 'trial', modules: ['core_data'], trialEndsAt: later, state: 'trial' });
    const e = resolveEntitlements(catalog, inputs({ tenant: trial }), { now });
    expect(e.state).toBe('trial');
    expect(e.features).not.toContain('realtime.sse');

    // o job tenant.lifecycle ainda não rodou: o prazo vencido vale como trial_expired
    const expired = resolveEntitlements(catalog, inputs({ tenant: { ...trial, trialEndsAt: past } }), {
      now,
    });
    expect(expired.state).toBe('trial_expired');
    expect(expired.modules).toEqual([]);
    expect(expired.features).toEqual([]);
    // a coluna já diz trial_expired: o mesmo, sem depender do prazo
    expect(
      resolveEntitlements(catalog, inputs({ tenant: tenantRow({ state: 'trial_expired' }) }), { now })
        .modules,
    ).toEqual([]);
    // o prazo vencido só vale no estado trial: active com trial_ends_at antigo segue active
    expect(
      resolveEntitlements(catalog, inputs({ tenant: tenantRow({ state: 'active', trialEndsAt: past }) }), {
        now,
      }).state,
    ).toBe('active');

    const suspended = resolveEntitlements(catalog, inputs({ tenant: tenantRow({ state: 'suspended' }) }), {
      now,
    });
    expect(suspended.state).toBe('suspended');
    expect(suspended.modules).toEqual([]);
  });

  it('conta em trial (decisão 14): limites do modelo trial, SSE com 5 conexões e sem webhooks; active não muda', () => {
    // o cadastro provisiona com o plano Fan Experience (300/min, 500 mil por dia) e a conta em trial
    const trial = tenantRow({ trialEndsAt: later, state: 'trial' });
    const e = resolveEntitlements(catalog, inputs({ tenant: trial }), { now });
    expect(e.state).toBe('trial');
    expect(e.modules).toEqual(['core_data', 'semantic', 'where_to_watch']);
    expect(e.limits).toEqual({ rateLimitPerMinute: 60, dailyRequestQuota: 5000 });
    expect(e.features).toContain('realtime.sse');
    expect(e.features).not.toContain('realtime.webhooks');
    expect(e.tiers['core_data.sse_connections']).toBe(5);
    // o que é do tenant e já é menor fica (o menor dos dois); sem cota no tenant, vale a do modelo
    const small = tenantRow({
      trialEndsAt: later,
      state: 'trial',
      rateLimitPerMinute: 30,
      dailyRequestQuota: null,
    });
    const s = resolveEntitlements(catalog, inputs({ tenant: small }), { now });
    expect(s.limits).toEqual({ rateLimitPerMinute: 30, dailyRequestQuota: 5000 });
    // fora de trial, nada disso vale
    const active = resolveEntitlements(catalog, inputs({ tenant: tenantRow({ trialEndsAt: later }) }), {
      now,
    });
    expect(active.limits).toEqual({ rateLimitPerMinute: 300, dailyRequestQuota: 500_000 });
    expect(active.features).toContain('realtime.webhooks');
    expect(active.tiers['core_data.sse_connections']).toBe(100);
    // o tenant legado de plano trial segue como está (decisão 13): já tem 60 e 5 mil, e sem tempo real pelo plano
    const legacy = resolveEntitlements(
      catalog,
      inputs({
        tenant: tenantRow({
          plan: 'trial',
          modules: ['core_data'],
          rateLimitPerMinute: 60,
          dailyRequestQuota: 5000,
          trialEndsAt: later,
          state: 'trial',
        }),
      }),
      { now },
    );
    expect(legacy.limits).toEqual({ rateLimitPerMinute: 60, dailyRequestQuota: 5000 });
    expect(legacy.features).not.toContain('realtime.sse');
    expect(minQuota(null, null)).toBeNull();
    expect(minQuota(10, null)).toBe(10);
    expect(minQuota(null, 7)).toBe(7);
  });

  it('módulo em teste pela loja (decisão 9): moduleTrials traz o prazo só enquanto o módulo está nos direitos', () => {
    const endsAt = new Date('2026-11-30T12:00:00Z');
    const grant = override({ kind: 'module_grant', key: 'live_chat', validUntil: endsAt });
    const e = resolveEntitlements(
      catalog,
      inputs({ overrides: [grant], moduleTrials: [{ module: 'live_chat', endsAt }] }),
      { now },
    );
    expect(e.modules).toContain('live_chat');
    expect(e.moduleTrials).toEqual({ live_chat: endsAt.toISOString() });
    // o teste venceu (o override também): o módulo sai e o prazo some
    const after = new Date('2026-12-01T00:00:00Z');
    const gone = resolveEntitlements(
      catalog,
      inputs({ overrides: [grant], moduleTrials: [{ module: 'live_chat', endsAt }] }),
      { now: after },
    );
    expect(gone.modules).not.toContain('live_chat');
    expect(gone.moduleTrials).toEqual({});
    // registro de teste sem o módulo nos direitos (override revogado) não aparece; módulo desconhecido avisa
    const orphan = resolveEntitlements(
      catalog,
      inputs({
        moduleTrials: [
          { module: 'live_chat', endsAt },
          { module: 'nope', endsAt },
        ],
      }),
      { now },
    );
    expect(orphan.moduleTrials).toEqual({});
    expect(orphan.warnings).toContain('teste de módulo desconhecido: nope');
    // a versão muda com o teste (cache e eventos)
    expect(e.version).not.toBe(resolveEntitlements(catalog, inputs({ overrides: [grant] }), { now }).version);
  });

  it('estados da F3: draft, pending_review, rejected e cancelled sem acesso; past_due passa como active', () => {
    for (const state of ['draft', 'pending_review', 'rejected', 'cancelled'] as const) {
      const e = resolveEntitlements(catalog, inputs({ tenant: tenantRow({ state }) }), { now });
      expect(e.state).toBe(state);
      expect(e.modules).toEqual([]);
    }
    const pastDue = resolveEntitlements(catalog, inputs({ tenant: tenantRow({ state: 'past_due' }) }), {
      now,
    });
    expect(pastDue.state).toBe('past_due');
    expect(pastDue.modules).toEqual(['core_data', 'semantic', 'where_to_watch']);
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

  it('exceções que se contradizem: vale a mais nova, qualquer que seja a ordem das linhas', () => {
    const grant = override({
      kind: 'module_grant',
      key: 'live_chat',
      createdAt: new Date('2026-11-02T00:00:00Z'),
    });
    const revoke = override({
      kind: 'module_revoke',
      key: 'live_chat',
      createdAt: new Date('2026-11-05T00:00:00Z'),
    });
    const t1 = override({
      kind: 'tier',
      key: 'live_chat.peak_connections',
      value: 100_000,
      createdAt: new Date('2026-11-03T00:00:00Z'),
    });
    const t2 = override({
      kind: 'tier',
      key: 'live_chat.peak_connections',
      value: 25_000,
      createdAt: new Date('2026-11-04T00:00:00Z'),
    });
    for (const order of [
      [grant, revoke],
      [revoke, grant],
    ])
      expect(resolveEntitlements(catalog, inputs({ overrides: order }), { now }).modules).not.toContain(
        'live_chat',
      );
    const tenant = tenantRow({ modules: ['core_data', 'where_to_watch', 'semantic', 'live_chat'] });
    for (const order of [
      [t1, t2],
      [t2, t1],
    ])
      expect(
        resolveEntitlements(catalog, inputs({ tenant, overrides: order }), { now }).tiers[
          'live_chat.peak_connections'
        ],
      ).toBe(25_000);
    // mesmo instante: o id desempata
    const sameAt = new Date('2026-11-06T00:00:00Z');
    const a = { ...grant, id: '00000000-0000-7000-8000-00000000aaaa', createdAt: sameAt };
    const b = { ...revoke, id: '00000000-0000-7000-8000-00000000bbbb', createdAt: sameAt };
    for (const order of [
      [a, b],
      [b, a],
    ])
      expect(resolveEntitlements(catalog, inputs({ overrides: order }), { now }).modules).not.toContain(
        'live_chat',
      );
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

describe('cacheTtlSeconds', () => {
  const at = new Date('2026-11-12T12:00:00.000Z');
  const plus = (ms: number) => new Date(at.getTime() + ms);
  it('nunca passa do prazo: arredonda para baixo e não grava com menos de um segundo', async () => {
    const { cacheTtlSeconds } = await import('./load.js');
    expect(cacheTtlSeconds(60, [], at)).toBe(60);
    expect(cacheTtlSeconds(60, [plus(1_100)], at)).toBe(1);
    expect(cacheTtlSeconds(60, [plus(900)], at)).toBe(0);
    expect(cacheTtlSeconds(60, [plus(30_999), null, plus(-5)], at)).toBe(30);
  });
});
