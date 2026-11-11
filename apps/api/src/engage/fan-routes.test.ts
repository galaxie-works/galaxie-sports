import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { memoryTenant } from '../test-helpers.js';
import { MemoryFanRevocations } from './fan-auth.js';
import { FanTokenSigner, type FanTokenClaims } from './fan-token.js';

const signer = new FanTokenSigner({ secret: 'k'.repeat(40) });
const body = {
  externalAccountId: 'acc_1',
  externalProfileId: 'prof_1',
  nickname: 'Tricolor_77',
  ageBand: '18plus',
  country: 'br',
  locale: 'pt-BR',
};
const claims = (over: Partial<FanTokenClaims> = {}): Omit<FanTokenClaims, 'exp'> => ({
  tenantId: 'tenant-x',
  accountId: '0190f1c0-0000-7000-8000-0000000000a1',
  profileId: '0190f1c0-0000-7000-8000-0000000000b1',
  ageBand: '18plus',
  country: 'BR',
  locale: 'pt-BR',
  holderAdult: 'unknown',
  surface: 'web',
  ...over,
});

describe('POST /v1/fans/tokens', () => {
  it('chave publicável nunca emite token', async () => {
    const app = buildServer({ usage: false, fanTokens: signer });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-publishable-key': 'gs_pk_live_x' },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PUBLISHABLE_KEY_NOT_ALLOWED');
  });

  it('sem módulo de engajamento no plano → 403', async () => {
    const { store, key } = await memoryTenant({ modules: ['core_data'] });
    const app = buildServer({ tenantStore: store, usage: false, fanTokens: signer });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-key': key },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MODULE_NOT_IN_PLAN');
  });

  it('recusa campo fora da lista (e-mail, nascimento) e faixa desconhecida', async () => {
    const { store, key } = await memoryTenant({ modules: ['core_data', 'live_chat'] });
    const app = buildServer({ tenantStore: store, usage: false, fanTokens: signer });
    for (const extra of [{ email: 'a@b.c' }, { birthDate: '2010-01-01' }, { ageBand: 'adult' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/fans/tokens',
        headers: { 'x-galaxie-key': key },
        payload: { ...body, ...extra },
      });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(res.json().code).toBe('INVALID_PARAMS');
    }
  });

  it('sem FAN_TOKEN_SECRET → 503', async () => {
    const { store, key } = await memoryTenant({ modules: ['core_data', 'communities'] });
    const app = buildServer({ tenantStore: store, usage: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fans/tokens',
      headers: { 'x-galaxie-key': key },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('rotas do torcedor', () => {
  it('sem token, token inválido, vencido ou de Perfil excluído → 401', async () => {
    let now = 1_800_000_000_000;
    const clock = new FanTokenSigner({ secret: 'k'.repeat(40), now: () => now });
    const revocations = new MemoryFanRevocations();
    const app = buildServer({ usage: false, fanTokens: clock, fanRevocations: revocations });
    const get = (authorization?: string) =>
      app.inject({ method: 'GET', url: '/v1/fans/me', headers: authorization ? { authorization } : {} });
    expect((await get()).statusCode).toBe(401);
    expect((await get('Bearer gft_lixo.lixo')).statusCode).toBe(401);
    const other = new FanTokenSigner({ secret: 'z'.repeat(40) }).issue(claims()).token;
    expect((await get(`Bearer ${other}`)).statusCode).toBe(401);
    const { token } = clock.issue(claims(), 60);
    await revocations.revoke('tenant-x', claims().profileId, 60);
    expect((await get(`Bearer ${token}`)).statusCode).toBe(401);
    const fresh = clock.issue(claims({ profileId: '0190f1c0-0000-7000-8000-0000000000b2' }), 60).token;
    // válido: passa da autenticação e cai no banco ausente (503)
    expect((await get(`Bearer ${fresh}`)).statusCode).toBe(503);
    now += 61_000;
    expect((await get(`Bearer ${fresh}`)).statusCode).toBe(401);
  });

  it('under13 não muda o Perfil (403 FAN_AGE_RESTRICTED)', async () => {
    const app = buildServer({ usage: false, fanTokens: signer });
    const { token } = signer.issue(claims({ ageBand: 'under13' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/fans/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { visibility: { avatar: 'private' } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FAN_AGE_RESTRICTED');
  });

  it('sem FAN_TOKEN_SECRET as rotas do torcedor respondem 503', async () => {
    const app = buildServer({ usage: false });
    const { token } = signer.issue(claims());
    const res = await app.inject({
      method: 'GET',
      url: '/v1/fans/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
  });
});
