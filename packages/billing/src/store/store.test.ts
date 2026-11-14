import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog/catalog.js';
import { storeView } from './store.js';

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
