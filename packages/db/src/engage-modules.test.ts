import { describe, expect, it } from 'vitest';
import {
  API_PLANS,
  DATA_MODULES,
  ENGAGE_MODULES,
  isValidModuleLimit,
  MODULE_LIMITS,
  PLAN_MODULES,
} from './schema/api.js';

describe('módulos de engajamento (#1018)', () => {
  it('nenhum plano inclui módulo de engajamento: entram por contrato, tenant a tenant', () => {
    for (const plan of API_PLANS)
      for (const m of ENGAGE_MODULES) expect(PLAN_MODULES[plan], `${plan} com ${m}`).not.toContain(m);
  });

  it('o Enterprise tem todos os módulos de dados', () => {
    expect([...PLAN_MODULES.enterprise].sort()).toEqual([...DATA_MODULES].sort());
  });

  it('toda faixa aponta para um módulo de engajamento e o padrão é válido', () => {
    for (const [key, def] of Object.entries(MODULE_LIMITS)) {
      expect(ENGAGE_MODULES).toContain(def.module);
      expect(key.startsWith(`${def.module}.`)).toBe(true);
      expect(isValidModuleLimit(key as keyof typeof MODULE_LIMITS, def.default)).toBe(true);
    }
  });

  it('faixas fixas do chat: só 5 mil, 25 mil ou 100 mil', () => {
    expect(isValidModuleLimit('live_chat.peak_connections', 25_000)).toBe(true);
    expect(isValidModuleLimit('live_chat.peak_connections', 30_000)).toBe(false);
    expect(isValidModuleLimit('communities.max_communities', 0)).toBe(false);
    expect(isValidModuleLimit('communities.max_communities', 2.5)).toBe(false);
  });
});
