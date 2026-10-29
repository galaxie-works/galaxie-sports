import { describe, expect, it } from 'vitest';
import { Authenticator } from '../auth/authenticator.js';
import { memoryTenant } from '../test-helpers.js';
import { STREAM_TOKEN_PREFIX, StreamTokenSigner } from './stream-token.js';

const claims = { tenantId: 't1', keyPrefix: 'abc123', keyId: 'k1' };

describe('StreamTokenSigner', () => {
  it('emite e confere o token, com prazo de 5 minutos', () => {
    let now = Date.UTC(2026, 9, 28, 12);
    const signer = new StreamTokenSigner({ secret: 'x'.repeat(32), now: () => now });
    const { token, expiresAt } = signer.issue(claims);
    expect(token.startsWith(STREAM_TOKEN_PREFIX)).toBe(true);
    expect(expiresAt.getTime() - now).toBe(300_000);
    expect(signer.verify(token)).toMatchObject(claims);
    // dois tokens do mesmo segundo são diferentes
    expect(signer.issue(claims).token).not.toBe(token);
    now += 300_000;
    expect(signer.verify(token)).toBeNull();
  });

  it('recusa assinatura trocada, payload adulterado, outro segredo e lixo', () => {
    const signer = new StreamTokenSigner({ secret: 'x'.repeat(32) });
    const { token } = signer.issue(claims);
    const [body, sig] = token.slice(STREAM_TOKEN_PREFIX.length).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), t: 'outro' }),
    ).toString('base64url');
    expect(signer.verify(`${STREAM_TOKEN_PREFIX}${forged}.${sig}`)).toBeNull();
    expect(signer.verify(`${token}x`)).toBeNull();
    expect(new StreamTokenSigner({ secret: 'y'.repeat(32) }).verify(token)).toBeNull();
    expect(new StreamTokenSigner().verify(token)).toBeNull();
    for (const junk of ['', 'gst_', 'gst_a.b.c', 'gs_live_x', `${STREAM_TOKEN_PREFIX}${'a'.repeat(2000)}`])
      expect(signer.verify(junk)).toBeNull();
  });

  it('segredo curto é erro de configuração', () => {
    expect(() => new StreamTokenSigner({ secret: 'curto' })).toThrow(/32/);
  });

  it('o token não carrega o segredo da chave', async () => {
    const { key, prefix } = await memoryTenant();
    const { token } = new StreamTokenSigner().issue({ ...claims, keyPrefix: prefix });
    const secret = key.slice(key.lastIndexOf('_') + 1);
    expect(Buffer.from(token.slice(4).split('.')[0]!, 'base64url').toString()).not.toContain(secret);
  });
});

describe('Authenticator.authenticateProvenKey (revalidação do stream aberto com token)', () => {
  it('relê a chave pelo prefixo: válida dá o contexto; revogada, de outro id ou tenant suspenso, não', async () => {
    let now = new Date('2026-10-28T12:00:00Z');
    const { store, key, prefix } = await memoryTenant();
    const auth = new Authenticator(store, { now: () => now });
    const ctx = await auth.authenticate(key);
    expect(ctx.keyPrefix).toBe(prefix);
    await expect(auth.authenticateProvenKey(prefix, ctx.keyId)).resolves.toMatchObject({
      tenantId: ctx.tenantId,
      keyKind: 'secret',
    });
    await expect(auth.authenticateProvenKey(prefix, 'outra-chave')).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    await expect(auth.authenticateProvenKey('naoexiste', ctx.keyId)).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });

    const record = await store.findKeyByPrefix(prefix);
    record!.revokedAt = new Date(now.getTime() - 1);
    // cache de até 60 s; com maxAgeMs (heartbeat do SSE) a revogação aparece antes
    now = new Date(now.getTime() + 1_000);
    await expect(auth.authenticateProvenKey(prefix, ctx.keyId, { maxAgeMs: 0 })).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    record!.revokedAt = null;
    record!.tenant.status = 'suspended';
    await expect(auth.authenticateProvenKey(prefix, ctx.keyId, { maxAgeMs: 0 })).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
  });
});
