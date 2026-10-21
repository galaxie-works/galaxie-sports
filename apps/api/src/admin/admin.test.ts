import { describe, expect, it } from 'vitest';
import { PLAN_MODULES, API_PLANS } from '@galaxie/db';
import { AdminGuard, generateAdminKey, hashAdminKey, normalizeIp, parseIpAllowlist } from './guard.js';
import { loadPlans, parsePlans, PlansConfigError } from './plans.js';
import { invalidScopes, resolveTenantValues } from './tenants.js';

describe('config/plans.yaml', () => {
  it('tem um modelo válido para cada plano, coerente com os módulos padrão do schema', () => {
    const plans = loadPlans();
    for (const p of API_PLANS) {
      expect(plans[p].modules.sort()).toEqual([...PLAN_MODULES[p]].sort());
      expect(plans[p].rateLimitPerMinute).toBeGreaterThan(0);
    }
    expect(plans.core_data.name).toBe('Core Data');
    expect(plans.enterprise.dailyRequestQuota).toBeNull();
  });

  it('rejeita plano ausente, módulo desconhecido e limite inválido', () => {
    expect(() => parsePlans({ plans: {} })).toThrow(PlansConfigError);
    const base = { name: 'x', modules: ['core_data'], rateLimitPerMinute: 10 };
    const all = Object.fromEntries(API_PLANS.map((p) => [p, base]));
    expect(() => parsePlans({ plans: { ...all, core_data: { ...base, modules: ['radar'] } } })).toThrow(
      /modules/,
    );
    expect(() => parsePlans({ plans: { ...all, core_data: { ...base, rateLimitPerMinute: 0 } } })).toThrow(
      /rateLimitPerMinute/,
    );
    expect(
      parsePlans({ plans: { ...all, core_data: { ...base, markets: ['br'] } } }).core_data.markets,
    ).toEqual(['BR']);
  });

  it('valores do tenant = modelo do plano + ajustes', () => {
    const plans = loadPlans();
    expect(resolveTenantValues(plans, { plan: 'fan_experience' })).toMatchObject({
      modules: ['core_data', 'where_to_watch', 'semantic'],
      rateLimitPerMinute: plans.fan_experience.rateLimitPerMinute,
    });
    expect(
      resolveTenantValues(plans, {
        plan: 'core_data',
        markets: ['ar'],
        rateLimitPerMinute: 5,
        dailyRequestQuota: null,
      }),
    ).toMatchObject({ markets: ['AR'], rateLimitPerMinute: 5, dailyRequestQuota: null });
    expect(invalidScopes(['core_data'], ['core_data', 'semantic'])).toEqual(['semantic']);
  });
});

describe('AdminGuard', () => {
  it('aceita qualquer uma das chaves configuradas (rotação sem janela) e rejeita as demais', () => {
    const a = generateAdminKey();
    const b = generateAdminKey();
    expect(a).toMatch(/^gs_admin_[A-Za-z0-9_-]{43}$/);
    const guard = new AdminGuard({ keyHashes: [hashAdminKey(a), hashAdminKey(b)] });
    expect(guard.keyValid(a)).toBe(true);
    expect(guard.keyValid(b)).toBe(true);
    expect(guard.keyValid(generateAdminKey())).toBe(false);
    expect(guard.keyValid(undefined)).toBe(false);
    expect(guard.keyValid('gs_live_123')).toBe(false);
  });

  it('exige hashes no formato sha256$...', () => {
    expect(() => new AdminGuard({ keyHashes: ['scrypt$1$2'] })).toThrow(/ADMIN_KEY_HASHES/);
    expect(() => new AdminGuard({ keyHashes: [] })).toThrow();
  });

  it('allowlist de IP com IPv4, IPv6, CIDR e IPv4 mapeado', () => {
    const guard = new AdminGuard({
      keyHashes: [hashAdminKey(generateAdminKey())],
      ipAllowlist: ['10.0.0.0/8', '192.168.1.10', 'fd00::/8'],
    });
    expect(guard.ipAllowed('10.20.30.40')).toBe(true);
    expect(guard.ipAllowed('::ffff:10.1.2.3')).toBe(true);
    expect(guard.ipAllowed('192.168.1.10')).toBe(true);
    expect(guard.ipAllowed('192.168.1.11')).toBe(false);
    expect(guard.ipAllowed('fd12::1')).toBe(true);
    expect(guard.ipAllowed('2001:db8::1')).toBe(false);
    expect(guard.ipAllowed('lixo')).toBe(false);
    expect(normalizeIp('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    expect(() => parseIpAllowlist(['10.0.0.0/33'])).toThrow(/prefixo/);
    expect(() => parseIpAllowlist(['example.com'])).toThrow(/endereço/);
  });
});
