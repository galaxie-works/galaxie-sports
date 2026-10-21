import { describe, expect, it } from 'vitest';
import { InMemoryTenantStore } from './tenant-store.js';
import { Authenticator } from './authenticator.js';
import { generateApiKey, hashSecret, parseApiKey, verifySecret } from './keys.js';
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

  it('rejeita chave expirada', async () => {
    const { store, key, prefix } = await memoryTenant();
    store.keys.get(prefix)!.expiresAt = new Date(Date.now() - 1);
    await expect(new Authenticator(store).authenticate(key)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      detail: 'Chave expirada.',
    });
  });
});
