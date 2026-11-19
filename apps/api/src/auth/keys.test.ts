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
      detail: 'Key expired.',
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
      detail: 'Key revoked.',
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

describe('trial (docs/politica-de-chaves.md §3)', () => {
  it('depois do fim do trial nenhuma chave do tenant autentica: 401 TRIAL_EXPIRED, mesmo antes do tenant.lifecycle', async () => {
    const { store, key, prefix } = await memoryTenant({
      plan: 'trial',
      state: 'trial',
      trialEndsAt: new Date(Date.now() + 60_000),
    });
    const auth = new Authenticator(store, { cacheTtlMs: 0 });
    await expect(auth.authenticate(key)).resolves.toMatchObject({ plan: 'trial' });
    store.keys.get(prefix)!.tenant.trialEndsAt = new Date(Date.now() - 1);
    await expect(auth.authenticate(key)).rejects.toMatchObject({ status: 401, code: 'TRIAL_EXPIRED' });
    // a coluna já diz trial_expired: o mesmo código, sem depender do prazo
    store.keys.get(prefix)!.tenant.state = 'trial_expired';
    store.keys.get(prefix)!.tenant.trialEndsAt = null;
    await expect(auth.authenticate(key)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' });
  });
});

describe('estado do tenant (plataforma comercial F3, doc 02 "O que cada estado permite")', () => {
  const cases = [
    ['draft', 401, 'TENANT_PENDING_REVIEW'],
    ['pending_review', 401, 'TENANT_PENDING_REVIEW'],
    ['rejected', 401, 'TENANT_REJECTED'],
    ['trial_expired', 401, 'TRIAL_EXPIRED'],
    ['suspended', 402, 'SUBSCRIPTION_SUSPENDED'],
    ['cancelled', 401, 'TENANT_CANCELLED'],
  ] as const;

  it.each(cases)(
    '%s: a chave certa recebe %i %s; a errada, o 401 comum sem motivo',
    async (state, status, code) => {
      const { store, key } = await memoryTenant({ state });
      const auth = new Authenticator(store, { cacheTtlMs: 0 });
      // primeira chamada (segredo ainda não provado): o scrypt roda e, certo, a recusa diz o motivo
      await expect(auth.authenticate(key)).rejects.toMatchObject({ status, code });
      // segunda chamada: o segredo já é conhecido, a recusa sai antes do scrypt com o mesmo código
      await expect(auth.authenticate(key)).rejects.toMatchObject({ status, code });
      // quem só tem o prefixo não descobre o estado do cliente
      await expect(auth.authenticate(withRandomSecret(key))).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_KEY',
        detail: 'Send a valid key in the x-galaxie-key header.',
      });
    },
  );

  it('trial, active e past_due autenticam (past_due passa como active)', async () => {
    for (const state of ['trial', 'active', 'past_due'] as const) {
      const { store, key } = await memoryTenant({ state });
      await expect(new Authenticator(store).authenticate(key)).resolves.toMatchObject({ plan: 'core_data' });
    }
  });

  it('a chave já provada (token do SSE) recebe o código do estado direto', async () => {
    const { store, key, prefix } = await memoryTenant({ state: 'suspended' });
    const auth = new Authenticator(store, { cacheTtlMs: 0 });
    const keyId = store.keys.get(prefix)!.keyId;
    await expect(auth.authenticateProvenKey(prefix, keyId)).rejects.toMatchObject({
      status: 402,
      code: 'SUBSCRIPTION_SUSPENDED',
    });
    store.keys.get(prefix)!.tenant.state = 'active';
    await expect(auth.authenticateProvenKey(prefix, keyId)).resolves.toMatchObject({ keyId });
    expect(key).toBeTruthy();
  });

  it('o estado entra no diagnóstico como tenant_inactive só depois de provar a chave', async () => {
    const seen: { tenantId: string; reason: string }[] = [];
    const { store, key } = await memoryTenant({ state: 'cancelled' });
    const auth = new Authenticator(store, { cacheTtlMs: 0, onDenied: (d) => void seen.push(d) });
    await expect(auth.authenticate(withRandomSecret(key))).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(seen.map((d) => d.reason)).toEqual(['invalid_secret']);
    await expect(auth.authenticate(key)).rejects.toMatchObject({ code: 'TENANT_CANCELLED' });
    expect(seen.map((d) => d.reason)).toEqual(['invalid_secret', 'tenant_inactive']);
  });
});

describe('erros de acesso para o diagnóstico (#1007)', () => {
  type Denied = { tenantId: string; reason: string; keyPrefix: string };
  const recorder = () => {
    const seen: Denied[] = [];
    return { seen, onDenied: (d: Denied) => void seen.push(d) };
  };

  it('segredo errado, revogada, expirada e ambiente trocado chegam com tenant e prefixo, nunca o segredo', async () => {
    const { store, key, prefix } = await memoryTenant();
    const tenantId = store.keys.get(prefix)!.tenant.id;
    const r = recorder();
    const auth = new Authenticator(store, { onDenied: r.onDenied });
    const wrong = withRandomSecret(key);
    await expect(auth.authenticate(wrong)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    // o cache negativo do segredo errado também conta
    await expect(auth.authenticate(wrong)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    const p = parseApiKey(key)!;
    await expect(auth.authenticate(formatApiKey('test', prefix, p.secret))).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    store.keys.get(prefix)!.revokedAt = new Date(Date.now() - 1);
    const fresh = new Authenticator(store, { onDenied: r.onDenied });
    await expect(fresh.authenticate(key)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    // prefixo em cache negativo: repete o motivo
    await expect(fresh.authenticate(key)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(r.seen.map((d) => d.reason)).toEqual([
      'invalid_secret',
      'invalid_secret',
      'wrong_env',
      'revoked',
      'revoked',
    ]);
    expect(r.seen.every((d) => d.tenantId === tenantId && d.keyPrefix === prefix)).toBe(true);
    expect(JSON.stringify(r.seen)).not.toContain(p.secret);
  });

  it('expirada e tenant suspenso têm motivo próprio; prefixo desconhecido não chama (sem tenant)', async () => {
    const { store, key, prefix } = await memoryTenant();
    const r = recorder();
    store.keys.get(prefix)!.expiresAt = new Date(Date.now() - 1);
    await expect(new Authenticator(store, { onDenied: r.onDenied }).authenticate(key)).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    store.keys.get(prefix)!.expiresAt = null;
    store.keys.get(prefix)!.tenant.status = 'suspended';
    store.keys.get(prefix)!.tenant.state = 'suspended';
    await expect(new Authenticator(store, { onDenied: r.onDenied }).authenticate(key)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_SUSPENDED',
    });
    await expect(
      new Authenticator(store, { onDenied: r.onDenied }).authenticate(generateApiKey('live').key),
    ).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(r.seen.map((d) => d.reason)).toEqual(['expired', 'tenant_inactive']);
  });

  it('a chave já provada (SSE e revalidação) também registra revogada, expirada e tenant suspenso', async () => {
    const { store, prefix } = await memoryTenant();
    const rec = store.keys.get(prefix)!;
    const r = recorder();
    const proven = () =>
      new Authenticator(store, { onDenied: r.onDenied }).authenticateProvenKey(prefix, rec.keyId);
    rec.revokedAt = new Date(Date.now() - 1);
    await expect(proven()).rejects.toMatchObject({ code: 'INVALID_KEY' });
    rec.revokedAt = null;
    rec.expiresAt = new Date(Date.now() - 1);
    await expect(proven()).rejects.toMatchObject({ code: 'INVALID_KEY' });
    rec.expiresAt = null;
    rec.tenant.status = 'suspended';
    rec.tenant.state = 'suspended';
    await expect(proven()).rejects.toMatchObject({ code: 'SUBSCRIPTION_SUSPENDED' });
    expect(r.seen.map((d) => d.reason)).toEqual(['revoked', 'expired', 'tenant_inactive']);
    expect(r.seen.every((d) => d.tenantId === rec.tenant.id && d.keyPrefix === prefix)).toBe(true);
  });

  it('um onDenied que lança não muda a resposta', async () => {
    const { store, key } = await memoryTenant();
    const auth = new Authenticator(store, {
      onDenied: () => {
        throw new Error('banco fora');
      },
    });
    await expect(auth.authenticate(withRandomSecret(key))).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(auth.authenticate(key)).resolves.toMatchObject({ slug: 'teste' });
  });
});
