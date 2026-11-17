import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog/catalog.js';
import { canStartModuleTrial, storeView } from './store.js';

const catalog = loadCatalog();
const byModule = (items: ReturnType<typeof storeView>) => Object.fromEntries(items.map((i) => [i.module, i]));

describe('storeView (loja de features, #1137)', () => {
  it('um cartão por módulo do catálogo', () => {
    const items = storeView(catalog, { plan: 'core_data', modules: ['core_data'], state: 'active' });
    expect(items.map((i) => i.module).sort()).toEqual(Object.keys(catalog.modules).sort());
  });

  it('Core Data: o que tem, o que pede plano maior e o que é por contrato', () => {
    const v = byModule(storeView(catalog, { plan: 'core_data', modules: ['core_data'], state: 'active' }));
    expect(v.core_data?.state).toBe('included');
    expect(v.where_to_watch).toMatchObject({
      state: 'needs_plan',
      plans: ['fan_experience', 'live_intelligence'],
    });
    expect(v.multisport).toMatchObject({ state: 'needs_plan', plans: ['live_intelligence'] });
    expect(v.odds?.state).toBe('contract');
    expect(v.related_content?.state).toBe('closed');
    // a Cosmos não exige plano; os módulos de engajamento ainda não estão à venda
    expect(v.cosmos_ai?.state).toBe('available');
    expect(v.live_chat?.state).toBe('soon');
  });

  it('em teste, os módulos do tenant aparecem como teste', () => {
    const v = byModule(storeView(catalog, { plan: 'trial', modules: ['core_data'], state: 'trial' }));
    expect(v.core_data?.state).toBe('trial');
    expect(v.core_data?.trialEndsAt).toBeUndefined();
    // a conta em trial mostra o prazo da conta em cada módulo
    const withEnd = byModule(
      storeView(catalog, {
        plan: 'fan_experience',
        modules: ['core_data', 'where_to_watch', 'semantic'],
        state: 'trial',
        trialEndsAt: '2026-12-16T00:00:00.000Z',
      }),
    );
    expect(withEnd.where_to_watch).toMatchObject({ state: 'trial', trialEndsAt: '2026-12-16T00:00:00.000Z' });
  });

  it('módulo em teste pela loja (F3, decisão 9): a conta ativa distingue incluído de em teste, com o prazo', () => {
    const v = byModule(
      storeView(catalog, {
        plan: 'fan_experience',
        modules: ['core_data', 'where_to_watch', 'semantic', 'live_intelligence'],
        state: 'active',
        moduleTrials: { live_intelligence: '2026-11-30T12:00:00.000Z' },
      }),
    );
    expect(v.core_data?.state).toBe('included');
    expect(v.live_intelligence).toMatchObject({ state: 'trial', trialEndsAt: '2026-11-30T12:00:00.000Z' });
    // o prazo do módulo vale mesmo com a conta em trial (o módulo tem o próprio fim)
    const both = byModule(
      storeView(catalog, {
        plan: 'fan_experience',
        modules: ['core_data', 'live_intelligence'],
        state: 'trial',
        trialEndsAt: '2026-12-16T00:00:00.000Z',
        moduleTrials: { live_intelligence: '2026-11-30T12:00:00.000Z' },
      }),
    );
    expect(both.core_data?.trialEndsAt).toBe('2026-12-16T00:00:00.000Z');
    expect(both.live_intelligence?.trialEndsAt).toBe('2026-11-30T12:00:00.000Z');
  });

  it('"Ativar teste": só o cartão disponível com teste no catálogo e ainda não usado na organização', () => {
    const ent = {
      plan: 'fan_experience',
      modules: ['core_data', 'where_to_watch', 'semantic'],
      state: 'active',
    } as const;
    const fresh = byModule(storeView(catalog, ent));
    // a Cosmos está disponível mas não tem teste por dias (créditos próprios)
    expect(fresh.cosmos_ai).toMatchObject({ state: 'available', trialDays: null });
    expect(canStartModuleTrial(fresh.cosmos_ai!)).toBe(false);
    // módulo de dados vem pelo plano: não se testa pela loja; o de engajamento vendável, sim
    expect(canStartModuleTrial(fresh.live_intelligence!)).toBe(false);
    const engage = byModule(storeView(catalog, ent, { trialsUsed: ['communities'] }));
    expect(engage.live_chat?.state).toBe('soon');
    // teste já usado nesta organização: sem oferta, mesmo que o módulo volte a ficar disponível
    expect(engage.communities?.trialDays).toBeNull();
    // sem acesso: nada se ativa
    const blocked = byModule(storeView(catalog, { ...ent, state: 'trial_expired' }));
    expect(canStartModuleTrial(blocked.live_chat!)).toBe(false);
  });

  it('módulo concedido por exceção aparece como incluído, mesmo fora do plano', () => {
    const v = byModule(
      storeView(catalog, { plan: 'core_data', modules: ['core_data', 'odds'], state: 'active' }),
    );
    expect(v.odds?.state).toBe('included');
  });

  it('tenant sem acesso: tudo bloqueado, sem oferta de plano', () => {
    for (const state of ['suspended', 'trial_expired', 'cancelled'] as const) {
      const items = storeView(catalog, { plan: 'core_data', modules: [], state });
      expect(new Set(items.map((i) => i.state))).toEqual(new Set(['blocked']));
    }
  });

  it('plano maior só acima do atual; módulo do próprio plano retirado vira contrato', () => {
    const v = byModule(
      storeView(catalog, {
        plan: 'live_intelligence',
        modules: ['core_data', 'semantic', 'live_intelligence', 'multisport'],
        state: 'active',
      }),
    );
    expect(v.where_to_watch?.state).toBe('contract');
    const f = byModule(
      storeView(catalog, { plan: 'fan_experience', modules: ['core_data'], state: 'active' }),
    );
    expect(f.multisport).toMatchObject({ state: 'needs_plan', plans: ['live_intelligence'] });
  });
});
