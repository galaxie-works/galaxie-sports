import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  API_PLANS,
  DATA_MODULES,
  ENGAGE_MODULES,
  isValidModuleLimit,
  MODULE_LIMIT_MODULES,
  PLAN_MODULES,
} from './schema/api.js';
import { organization } from './schema/billing.js';
import { CAPACITY_TIERS, tenant } from './schema/api.js';

describe('módulos de engajamento (#1018)', () => {
  it('nenhum plano inclui módulo de engajamento: entram por contrato, tenant a tenant', () => {
    for (const plan of API_PLANS)
      for (const m of ENGAGE_MODULES) expect(PLAN_MODULES[plan], `${plan} com ${m}`).not.toContain(m);
  });

  it('o Enterprise tem todos os módulos de dados', () => {
    expect([...PLAN_MODULES.enterprise].sort()).toEqual([...DATA_MODULES].sort());
  });

  it('toda faixa que o código lê aponta para um módulo de engajamento dono da chave', () => {
    for (const [key, module] of Object.entries(MODULE_LIMIT_MODULES)) {
      expect(ENGAGE_MODULES).toContain(module);
      expect(key.startsWith(`${module}.`)).toBe(true);
    }
  });

  it('valor aceito: dentro do teto, inteiro e, com faixas fixas, uma delas (valores do catálogo, #1446)', () => {
    const peak = {
      module: 'live_chat',
      min: 5_000,
      max: 100_000,
      default: 5_000,
      tiers: [5_000, 25_000],
    } as const;
    const open = { module: 'communities', min: 1, max: 500, default: 5, tiers: null } as const;
    expect(isValidModuleLimit(peak, 25_000)).toBe(true);
    expect(isValidModuleLimit(peak, 30_000)).toBe(false);
    expect(isValidModuleLimit(open, 0)).toBe(false);
    expect(isValidModuleLimit(open, 2.5)).toBe(false);
    expect(isValidModuleLimit(open, 500)).toBe(true);
  });
});

describe('faixas de capacidade (#1446)', () => {
  // o check constraint repete a lista (faixa nova exige migration): os dois não podem divergir
  const tiersInCheck = (table: Parameters<typeof getTableConfig>[0], name: string) => {
    const c = getTableConfig(table).checks.find((x) => x.name === name);
    expect(c, name).toBeDefined();
    const text = new PgDialect().sqlToQuery(c!.value).sql;
    return [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  it('os check constraints aceitam exatamente CAPACITY_TIERS', () => {
    expect(tiersInCheck(organization, 'organization_capacity_tier')).toEqual([...CAPACITY_TIERS]);
    expect(tiersInCheck(tenant, 'tenant_capacity_tier')).toEqual([...CAPACITY_TIERS]);
  });
});
