import { describe, expect, it } from 'vitest';
import { InMemoryTenantStore } from './tenant-store.js';
import { Authenticator } from './authenticator.js';
import { generateApiKey, hashSecret, parseApiKey, verifySecret } from './keys.js';
import { AuthThrottle } from './throttle.js';
import { MemoryRateLimiter } from '../rate-limit.js';
import { memoryTenant } from '../test-helpers.js';

describe('chaves de API', () => {
  it('gera chaves no formato gs_<env>_<prefixo>_<segredo> e as interpreta de volta', () => {
    const k = generateApiKey('live');
    expect(k.key).toMatch(/^gs_live_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(parseApiKey(k.key)).toEqual({ env: 'live', prefix: k.prefix, secret: k.secret });
    expect(parseApiKey('gs_live_curta')).toBeNull();
  });

  it('guarda só o hash scrypt com sal e verifica em tempo constante', async () => {
    const { secret } = generateApiKey();
    const a = await hashSecret(secret);
    const b = await hashSecret(secret);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(await verifySecret(secret, a)).toBe(true);
    expect(await verifySecret(`${secret.slice(0, -1)}x`, a)).toBe(false);
    expect(await verifySecret(secret, 'bcrypt$whatever')).toBe(false);
  });
});

describe('Authenticator', () => {
  it('restringe os módulos do tenant aos escopos da chave e cacheia a verificação', async () => {
    const store = new InMemoryTenantStore();
    const { key } = await memoryTenant({ plan: 'enterprise', scopes: ['core_data', 'semantic'] }, store);
    let calls = 0;
    const counting = {
      findKeyByPrefix: (p: string) => {
        calls += 1;
        return store.findKeyByPrefix(p);
      },
      touchKey: store.touchKey.bind(store),
    };
    const auth = new Authenticator(counting);
    const ctx = await auth.authenticate(key);
    expect(ctx.modules).toEqual(['core_data', 'semantic']);
    await auth.authenticate(key);
    expect(calls).toBe(1);
    expect(store.touched).toHaveLength(1);
  });

  it('não recalcula o scrypt para o mesmo segredo errado dentro da janela de cache', async () => {
    const { store, key } = await memoryTenant();
    let lookups = 0;
    const counting = {
      findKeyByPrefix: (p: string) => {
        lookups += 1;
        return store.findKeyByPrefix(p);
      },
      touchKey: store.touchKey.bind(store),
    };
    const auth = new Authenticator(counting);
    const wrong = `${key.slice(0, -4)}AAAA`;
    await expect(auth.authenticate(wrong)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(auth.authenticate(wrong)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(lookups).toBe(1);
    await expect(auth.authenticate(key)).resolves.toMatchObject({ slug: 'teste' });
  });

  it('rejeita chave expirada', async () => {
    const { store, key, prefix } = await memoryTenant();
    store.keys.get(prefix)!.expiresAt = new Date(Date.now() - 1);
    await expect(new Authenticator(store).authenticate(key)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      detail: 'Chave expirada.',
    });
  });
});

describe('Authenticator sob chaves aleatórias (auditoria API-2)', () => {
  const counting = (store: InMemoryTenantStore) => {
    const stats = { lookups: 0 };
    return {
      stats,
      store: {
        findKeyByPrefix: (p: string) => {
          stats.lookups += 1;
          return store.findKeyByPrefix(p);
        },
        touchKey: store.touchKey.bind(store),
      },
    };
  };
  const randomSecret = (key: string) => `${key.slice(0, -43)}${generateApiKey().secret}`;
  const throttle = (attemptsPerMinute: number) =>
    new AuthThrottle(new MemoryRateLimiter(), { attemptsPerMinute });

  it('segredos aleatórios para um prefixo real: limite por prefixo antes do scrypt; a chave legítima segue', async () => {
    const { store, key } = await memoryTenant();
    // sem cache de contexto: toda requisição relê o banco (o pior caso)
    const auth = new Authenticator(store, { cacheTtlMs: 0, throttle: throttle(3) });
    await expect(auth.authenticate(key, { ip: '198.51.100.1' })).resolves.toMatchObject({ slug: 'teste' });
    const codes: string[] = [];
    for (let i = 0; i < 6; i++)
      codes.push(
        await auth
          .authenticate(randomSecret(key), { ip: `203.0.113.${i}` })
          .then(() => 'OK')
          .catch((e: { code: string }) => e.code),
      );
    // 1 tentativa da chave legítima + 2 erradas consomem as 3 do prefixo; o resto nem chega ao scrypt
    expect(codes).toEqual([
      'INVALID_KEY',
      'INVALID_KEY',
      'RATE_LIMITED',
      'RATE_LIMITED',
      'RATE_LIMITED',
      'RATE_LIMITED',
    ]);
    // segredo já verificado dispensa limite e scrypt: o ataque ao prefixo não derruba o cliente
    await expect(auth.authenticate(key, { ip: '198.51.100.1' })).resolves.toMatchObject({ slug: 'teste' });
  });

  it('prefixos aleatórios do mesmo IP: limite por IP antes do banco', async () => {
    const { store } = await memoryTenant();
    const c = counting(store);
    const auth = new Authenticator(c.store, { throttle: throttle(5) });
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++)
      await auth
        .authenticate(generateApiKey().key, { ip: '203.0.113.7' })
        .catch((e: { code: string }) => codes.add(e.code));
    expect(c.stats.lookups).toBe(5);
    expect([...codes].sort()).toEqual(['INVALID_KEY', 'RATE_LIMITED']);
  });

  it('prefixo inexistente fica em cache negativo: segredos diferentes não repetem a consulta', async () => {
    const { store } = await memoryTenant();
    const c = counting(store);
    const auth = new Authenticator(c.store);
    const ghost = generateApiKey().key;
    for (let i = 0; i < 5; i++)
      await expect(auth.authenticate(randomSecret(ghost))).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(c.stats.lookups).toBe(1);
  });

  it('chave revogada responde sem scrypt (não consome o limite do prefixo)', async () => {
    const { store, key, prefix } = await memoryTenant();
    store.keys.get(prefix)!.revokedAt = new Date(Date.now() - 1);
    const auth = new Authenticator(store, { cacheTtlMs: 0, throttle: throttle(1) });
    for (let i = 0; i < 4; i++)
      await expect(auth.authenticate(randomSecret(key), { ip: `203.0.113.${i}` })).rejects.toMatchObject({
        code: 'INVALID_KEY',
        detail: 'Chave revogada.',
      });
  });
});
