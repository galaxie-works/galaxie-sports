import { describe, expect, it } from 'vitest';
import { generatePublishableKey, type VerifiedPublishableKey } from '@galaxie/db';
import { ProblemError } from '../errors.js';
import { MemoryRateLimiter } from '../rate-limit.js';
import { PublishableAuthenticator, type PublishableStore } from './publishable.js';
import { AuthThrottle } from './throttle.js';

function store(records: Record<string, VerifiedPublishableKey>) {
  const calls = { verify: 0, touch: [] as string[] };
  const s: PublishableStore = {
    async verify(key) {
      calls.verify += 1;
      return records[key] ?? null;
    },
    async touch(keyId) {
      calls.touch.push(keyId);
    },
    async activeOrigins() {
      return Object.values(records).flatMap((r) => r.allowedOrigins);
    },
  };
  return { s, calls };
}

const record = (over: Partial<VerifiedPublishableKey> = {}): VerifiedPublishableKey => ({
  keyId: 'pk-1',
  tenantId: 't-1',
  tenant: {
    id: 't-1',
    slug: 'operadora-exemplo',
    plan: 'fan_experience',
    modules: ['core_data', 'where_to_watch', 'semantic'],
    markets: ['BR'],
    sports: ['football'],
    rateLimitPerMinute: 120,
  },
  allowedOrigins: ['https://app.exemplo.test', 'https://*.exemplo.test'],
  widgetId: null,
  widgetKind: null,
  ...over,
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof ProblemError ? `${err.status} ${err.code}` : String(err);
  }
};

describe('PublishableAuthenticator', () => {
  it('monta o contexto do tenant e marca como publicável', async () => {
    const { key } = generatePublishableKey();
    const { s, calls } = store({ [key]: record() });
    const auth = new PublishableAuthenticator(s);
    const ctx = await auth.authenticate(key, 'https://app.exemplo.test');
    expect(ctx).toMatchObject({
      tenantId: 't-1',
      keyId: 'pk-1',
      keyKind: 'publishable',
      modules: ['core_data', 'where_to_watch', 'semantic'],
      sports: ['football'],
    });
    expect(calls.touch).toEqual(['pk-1']);
    // cache: a segunda chamada não vai ao banco nem marca uso de novo
    await auth.authenticate(key, 'https://loja.exemplo.test');
    expect(calls.verify).toBe(1);
    expect(calls.touch).toEqual(['pk-1']);
  });

  it('chave presa a widget fica só com os módulos do tipo', async () => {
    const { key } = generatePublishableKey();
    const { s } = store({ [key]: record({ widgetId: 'w-1', widgetKind: 'standings' }) });
    const ctx = await new PublishableAuthenticator(s).authenticate(key, 'https://app.exemplo.test');
    expect(ctx.modules).toEqual(['core_data']);
    expect(ctx.widgetId).toBe('w-1');
  });

  it('erros: formato e chave desconhecida → 401; origem → 403', async () => {
    const { key } = generatePublishableKey();
    const { s } = store({ [key]: record() });
    const auth = new PublishableAuthenticator(s);
    expect(await code(auth.authenticate('gs_pk_live_x', 'https://app.exemplo.test'))).toBe('401 INVALID_KEY');
    expect(await code(auth.authenticate(generatePublishableKey().key, 'https://app.exemplo.test'))).toBe(
      '401 INVALID_KEY',
    );
    expect(await code(auth.authenticate(key, 'https://atacante.test'))).toBe('403 ORIGIN_NOT_ALLOWED');
    expect(await code(auth.authenticate(key, undefined))).toBe('403 ORIGIN_NOT_ALLOWED');
  });

  it('preflight: só origens de chaves ativas', async () => {
    const { key } = generatePublishableKey();
    const auth = new PublishableAuthenticator(store({ [key]: record() }).s);
    expect(await auth.isRegisteredOrigin('https://a.exemplo.test')).toBe(true);
    expect(await auth.isRegisteredOrigin('https://atacante.test')).toBe(false);
  });

  it('chaves aleatórias do mesmo IP: limite antes da consulta ao banco (auditoria API-2)', async () => {
    const { key } = generatePublishableKey();
    const { s, calls } = store({ [key]: record() });
    const throttle = new AuthThrottle(new MemoryRateLimiter(), { attemptsPerMinute: 3 });
    const auth = new PublishableAuthenticator(s, { throttle });
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push(
        await code(
          auth.authenticate(generatePublishableKey().key, 'https://app.exemplo.test', { ip: '203.0.113.9' }),
        ),
      );
    expect(results).toEqual([
      '401 INVALID_KEY',
      '401 INVALID_KEY',
      '401 INVALID_KEY',
      '429 RATE_LIMITED',
      '429 RATE_LIMITED',
      '429 RATE_LIMITED',
    ]);
    expect(calls.verify).toBe(3);
    // IPv6: o /64 inteiro é um balde só (girar o endereço não fura o limite)
    const v6 = new PublishableAuthenticator(s, {
      throttle: new AuthThrottle(new MemoryRateLimiter(), { attemptsPerMinute: 2 }),
    });
    const v6Results = [];
    for (let i = 1; i <= 4; i++)
      v6Results.push(
        await code(
          v6.authenticate(generatePublishableKey().key, 'https://app.exemplo.test', {
            ip: `2001:db8:1:2::${i}`,
          }),
        ),
      );
    expect(v6Results).toEqual(['401 INVALID_KEY', '401 INVALID_KEY', '429 RATE_LIMITED', '429 RATE_LIMITED']);
    // outro IP com a chave válida não é afetado
    expect(await code(auth.authenticate(key, 'https://app.exemplo.test', { ip: '198.51.100.2' }))).toBe('ok');
  });
});
