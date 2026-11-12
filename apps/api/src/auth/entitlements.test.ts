import { describe, expect, it } from 'vitest';
import { upgradeUrl } from '../errors.js';
import { withEntitlements, type TenantContext } from './authenticator.js';

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: 't1',
  slug: 'cliente',
  plan: 'fan_experience',
  keyId: 'k1',
  keyKind: 'secret',
  env: 'live',
  modules: ['core_data', 'where_to_watch', 'semantic'],
  keyAllows: null,
  markets: [],
  sports: [],
  rateLimitPerMinute: 300,
  ...over,
});

describe('withEntitlements (#1137)', () => {
  it('módulo concedido por exceção entra; retirado sai', () => {
    const out = withEntitlements(ctx(), {
      modules: ['core_data', 'live_chat', 'where_to_watch'],
      features: ['realtime.sse'],
    });
    expect(out.modules).toEqual(['core_data', 'live_chat', 'where_to_watch']);
    expect(out.features).toEqual(['realtime.sse']);
  });

  it('respeita o que a chave restringe (escopos ou tipo de widget)', () => {
    const out = withEntitlements(ctx({ keyAllows: ['core_data'] }), {
      modules: ['core_data', 'live_chat'],
      features: [],
    });
    expect(out.modules).toEqual(['core_data']);
  });

  it('módulo fechado continua fora para a chave publicável', () => {
    const out = withEntitlements(ctx({ keyKind: 'publishable' }), {
      modules: ['core_data', 'related_content'],
      features: [],
    });
    expect(out.modules).toEqual(['core_data']);
  });
});

describe('upgradeUrl', () => {
  it('só com UPGRADE_URL_BASE válida e nome de módulo', () => {
    const prev = process.env.UPGRADE_URL_BASE;
    try {
      delete process.env.UPGRADE_URL_BASE;
      expect(upgradeUrl('odds')).toBeUndefined();
      process.env.UPGRADE_URL_BASE = 'https://console.example.com/plans';
      expect(upgradeUrl('odds')).toBe('https://console.example.com/plans?module=odds');
      expect(upgradeUrl('de engajamento')).toBeUndefined();
      process.env.UPGRADE_URL_BASE = 'não é url';
      expect(upgradeUrl('odds')).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.UPGRADE_URL_BASE;
      else process.env.UPGRADE_URL_BASE = prev;
    }
  });
});

describe('memoResolver', () => {
  it('guarda o resultado e a falha por memoMs; forget apaga; demora acima do teto vira falha', async () => {
    const { memoResolver } = await import('./entitlements.js');
    let t = 0;
    let calls = 0;
    let fail = false;
    const m = memoResolver(
      async () => {
        calls += 1;
        if (fail) throw new Error('banco fora');
        return { modules: ['core_data'], features: [] };
      },
      { memoMs: 5_000, now: () => t },
    );
    await m.resolve('a');
    await m.resolve('a');
    expect(calls).toBe(1);
    m.forget('a');
    fail = true;
    await expect(m.resolve('a')).rejects.toThrow('banco fora');
    // a falha fica guardada: a próxima não chama o banco de novo
    await expect(m.resolve('a')).rejects.toThrow('banco fora');
    expect(calls).toBe(2);
    t = 6_000;
    fail = false;
    await expect(m.resolve('a')).resolves.toEqual({ modules: ['core_data'], features: [] });
    expect(calls).toBe(3);

    const slow = memoResolver(() => new Promise(() => {}), { timeoutMs: 20 });
    await expect(slow.resolve('b')).rejects.toThrow('sem resposta em 20 ms');
  });
});
