import { describe, expect, it } from 'vitest';
import { InMemoryTenantStore } from './tenant-store.js';
import { Authenticator } from './authenticator.js';
import {
  API_KEY_SCAN_PATTERN,
  formatApiKey,
  generateApiKey,
  hashSecret,
  parseApiKey,
  verifySecret,
} from './keys.js';
import { AuthThrottle, ipBucket } from './throttle.js';
import { MemoryVerifiedKeyStore } from './verified-keys.js';
import { MemoryRateLimiter } from '../rate-limit.js';
import { memoryTenant, withRandomSecret } from '../test-helpers.js';

describe('chaves de API', () => {
  it('gera chaves no formato gs_<env>_<prefixo>_<segredo>_<crc32> e as interpreta de volta', () => {
    const k = generateApiKey('live');
    expect(k.key).toMatch(/^gs_live_[0-9a-f]{12}_[A-Za-z0-9_-]{43}_[0-9a-f]{8}$/);
    expect(parseApiKey(k.key)).toEqual({ env: 'live', prefix: k.prefix, secret: k.secret, format: 2 });
    expect(parseApiKey('gs_live_curta')).toBeNull();
    // o padrão de varredura (gitleaks, secret scanning) acha a chave no meio de um texto
    expect(new RegExp(API_KEY_SCAN_PATTERN).exec(`KEY="${k.key}"`)?.[0]).toBe(k.key);
  });

  it('checksum: erro de digitação ou chave inventada é recusado sem consultar o banco', () => {
    const k = generateApiKey('test');
    const typo = `${k.key.slice(0, 20)}${k.key[20] === 'a' ? 'b' : 'a'}${k.key.slice(21)}`;
    expect(parseApiKey(typo)).toBeNull();
    // trocar o ambiente no texto também invalida o checksum
    expect(parseApiKey(k.key.replace('gs_test_', 'gs_live_'))).toBeNull();
    // formato legado (sem checksum) ainda é lido, marcado como formato 1
    const legacy = `gs_live_${k.prefix}_${k.secret}`;
    expect(parseApiKey(legacy)).toMatchObject({ env: 'live', format: 1 });
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
    const wrong = withRandomSecret(key);
    await expect(auth.authenticate(wrong)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(auth.authenticate(wrong)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(lookups).toBe(1);
    await expect(auth.authenticate(key)).resolves.toMatchObject({ slug: 'teste' });
  });

  it('rejeita chave expirada; o motivo só para quem já acertou o segredo', async () => {
    const { store, key, prefix } = await memoryTenant();
    const auth = new Authenticator(store, { cacheTtlMs: 0 });
    await auth.authenticate(key);
    store.keys.get(prefix)!.expiresAt = new Date(Date.now() - 1);
    await expect(auth.authenticate(key)).rejects.toMatchObject({
      code: 'INVALID_KEY',
      detail: 'Chave expirada.',
    });
    // instância que nunca viu o segredo: 401 genérico (não é oráculo de status do prefixo)
    const fresh = await new Authenticator(store).authenticate(key).catch((e: { detail: string }) => e);
    expect(fresh).toMatchObject({ code: 'INVALID_KEY' });
    expect((fresh as { detail: string }).detail).not.toMatch(/expirada/);
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
  const randomSecret = withRandomSecret;
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
        detail: expect.not.stringMatching(/revogada/),
      });
  });

  it('TTL deslizante: com o prefixo sob ataque contínuo, a chave em uso segue válida depois de 1 h', async () => {
    const { store, key } = await memoryTenant();
    let now = Date.parse('2026-10-25T00:00:00Z');
    const clock = () => now;
    const auth = new Authenticator(store, {
      cacheTtlMs: 0,
      now: () => new Date(now),
      throttle: new AuthThrottle(new MemoryRateLimiter(clock), { attemptsPerMinute: 3 }),
    });
    await expect(auth.authenticate(key, { ip: '198.51.100.1' })).resolves.toMatchObject({ slug: 'teste' });
    for (let step = 0; step < 6; step++) {
      now += 30 * 60_000; // 3 h no total, sempre com o prefixo estourado
      for (let i = 0; i < 5; i++)
        await auth.authenticate(randomSecret(key), { ip: `203.0.113.${i}` }).catch(() => {});
      await expect(auth.authenticate(key, { ip: '198.51.100.1' })).resolves.toMatchObject({ slug: 'teste' });
    }
  });

  it('instância nova (deploy, restart, scale-out) reconhece a chave verificada por outra', async () => {
    const { store, key } = await memoryTenant();
    const shared = new MemoryVerifiedKeyStore();
    const limiter = new MemoryRateLimiter(); // o mesmo Valkey para as duas instâncias
    const instance = () =>
      new Authenticator(store, {
        cacheTtlMs: 0,
        verifiedKeys: shared,
        throttle: new AuthThrottle(limiter, { attemptsPerMinute: 3 }),
      });
    await instance().authenticate(key, { ip: '198.51.100.1' });
    const fresh = instance();
    // o ataque esgota o prefixo antes de a chave legítima chegar à instância nova
    for (let i = 0; i < 5; i++)
      await fresh.authenticate(randomSecret(key), { ip: `203.0.113.${i}` }).catch(() => {});
    await expect(fresh.authenticate(randomSecret(key), { ip: '203.0.113.50' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(fresh.authenticate(key, { ip: '198.51.100.1' })).resolves.toMatchObject({ slug: 'teste' });
  });

  it('maxAgeMs relê o registro mesmo com o contexto em cache (revogação no SSE)', async () => {
    const { store, key, prefix } = await memoryTenant();
    let now = Date.now();
    const auth = new Authenticator(store, { now: () => new Date(now) });
    await auth.authenticate(key);
    store.keys.get(prefix)!.revokedAt = new Date(now);
    now += 1_000;
    await expect(auth.authenticate(key)).resolves.toBeDefined(); // cache de 60 s
    await expect(auth.authenticate(key, { maxAgeMs: 500 })).rejects.toMatchObject({
      detail: 'Chave revogada.',
    });
  });
});

describe('AuthThrottle', () => {
  it('agrupa IPv6 por /64 e trata IPv4 mapeado como IPv4', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipBucket('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(ipBucket('198.51.100.7')).toBe('198.51.100.7');
  });

  it('Valkey fora: conta em memória em vez de liberar tudo (fail-open devolveria o DoS de scrypt)', async () => {
    const errors: unknown[] = [];
    const broken = { hit: async () => Promise.reject(new Error('valkey fora')) };
    const t = new AuthThrottle(broken, { attemptsPerMinute: 2, onError: (e) => errors.push(e) });
    await t.check('ip:203.0.113.1');
    await t.check('ip:203.0.113.1');
    await expect(t.check('ip:203.0.113.1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(errors).toHaveLength(3);
  });
});

describe('ambiente e formato da chave (docs/politica-de-chaves.md §1)', () => {
  it('prefixo que diverge do ambiente gravado → 401, sem bloquear a chave certa do mesmo prefixo', async () => {
    const { store, key, prefix } = await memoryTenant({ env: 'test' });
    const p = parseApiKey(key)!;
    const auth = new Authenticator(store);
    const asLive = formatApiKey('live', prefix, p.secret);
    await expect(auth.authenticate(asLive)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(auth.authenticate(key)).resolves.toMatchObject({ env: 'test' });
    // e a chave com o prefixo trocado continua recusada depois (não entrou em cache como válida)
    await expect(auth.authenticate(asLive)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('chave de formato 2 enviada sem o checksum → 401; legado (formato 1) segue até a migração', async () => {
    const { store, key, prefix } = await memoryTenant();
    const p = parseApiKey(key)!;
    const auth = new Authenticator(store);
    await expect(auth.authenticate(`gs_live_${prefix}_${p.secret}`)).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    store.keys.get(prefix)!.keyFormat = 1;
    await expect(auth.authenticate(`gs_live_${prefix}_${p.secret}`)).resolves.toMatchObject({ env: 'live' });
  });
});
