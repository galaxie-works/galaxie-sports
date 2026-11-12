import { describe, expect, it } from 'vitest';
import { generatePublishableKey } from '@galaxie/db';
import type { PublishableStore } from '../auth/publishable.js';
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
    for (const extra of [
      { email: 'a@b.c' },
      { birthDate: '2010-01-01' },
      { document: '123.456.789-00' },
      { ageBand: 'adult' },
      { ageBand: '15' },
      { ageAssurance: { method: 'document', at: '2026-11-01' } },
      { ageAssurance: { method: 'verified', at: '2026-11-01', document: 'x' } },
      { ageAssurance: { method: 'verified' } },
      { ageAssurance: { method: 'verified', at: '2999-01-01' } },
      { guardian: { status: 'granted', birthDate: '1980-01-01' } },
      { guardian: { status: 'ok' } },
    ]) {
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

describe('token do torcedor no navegador (widget, embed; #1020)', () => {
  const site = 'https://torcida.exemplo.test';
  const pkFor = (tenantId: string, key: string, widgetId: string | null = null): PublishableStore => ({
    async verify(raw) {
      return raw === key
        ? {
            keyId: `pk-${tenantId}`,
            tenantId,
            env: 'live',
            tenant: {
              id: tenantId,
              slug: tenantId,
              plan: 'fan_experience',
              modules: ['core_data'],
              markets: ['BR'],
              sports: ['football'],
              rateLimitPerMinute: 120,
              dailyRequestQuota: null,
            },
            allowedOrigins: [site],
            widgetId,
            widgetKind: widgetId ? 'standings' : null,
          }
        : null;
    },
    async touch() {},
    async activeOrigins() {
      return [site];
    },
  });
  const key = generatePublishableKey('live').key;
  const app = () =>
    buildServer({ usage: false, fanTokens: signer, publishableStore: pkFor('tenant-x', key) });
  const me = (a: ReturnType<typeof app>, token: string, headers: Record<string, string> = {}) =>
    a.inject({
      method: 'GET',
      url: '/v1/fans/me',
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  it('token de outro cliente na página deste → 401, que o widget lê (CORS da origem conferida)', async () => {
    const a = app();
    const { token } = signer.issue(claims({ tenantId: 'tenant-y' }));
    const res = await me(a, token, { 'x-galaxie-publishable-key': key, origin: site });
    expect(res.statusCode).toBe(401);
    expect(res.json().detail).toBe('Token de outro cliente.');
    expect(res.headers['access-control-allow-origin']).toBe(site);
  });

  it('token vencido → 401 com CORS, para o widget pedir outro ao site', async () => {
    const a = app();
    const old = new FanTokenSigner({ secret: 'k'.repeat(40), now: () => Date.now() - 3_600_000 });
    const { token } = old.issue(claims());
    const res = await me(a, token, { 'x-galaxie-publishable-key': key, origin: site });
    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(site);
    // sem a chave do site, nada de CORS
    const bare = await me(a, token, { origin: site });
    expect(bare.statusCode).toBe(401);
    expect(bare.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('chave presa a um widget de dados não leva o token do torcedor → 403', async () => {
    const a = buildServer({
      usage: false,
      fanTokens: signer,
      publishableStore: pkFor('tenant-x', key, 'w-1'),
    });
    const { token } = signer.issue(claims());
    const res = await me(a, token, { 'x-galaxie-publishable-key': key, origin: site });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PUBLISHABLE_KEY_NOT_ALLOWED');
  });

  it('chave do site fora da origem → 403; mesmo cliente passa e leva o CORS do site', async () => {
    const a = app();
    const { token } = signer.issue(claims());
    const wrong = await me(a, token, { 'x-galaxie-publishable-key': key, origin: 'https://outro.test' });
    expect(wrong.statusCode).toBe(403);
    // passa da autenticação e cai no banco ausente (503), com o CORS da origem conferida
    const ok = await me(a, token, { 'x-galaxie-publishable-key': key, origin: site });
    expect(ok.statusCode).toBe(503);
    expect(ok.headers['access-control-allow-origin']).toBe(site);
  });

  it('preflight libera Authorization e o método da rota do torcedor para a origem de uma chave', async () => {
    const a = app();
    const pre = await a.inject({
      method: 'OPTIONS',
      url: '/v1/fans/me',
      headers: {
        origin: site,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization, x-galaxie-publishable-key, content-type',
      },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(site);
    expect(String(pre.headers['access-control-allow-methods'])).toContain('PATCH');
    expect(String(pre.headers['access-control-allow-headers'])).toContain('authorization');
    // fora das rotas do torcedor, a chave publicável segue só leitura
    const other = await a.inject({
      method: 'OPTIONS',
      url: '/v1/events',
      headers: { origin: site, 'access-control-request-method': 'PATCH' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('portão de idade em toda rota do torcedor (#1106)', () => {
  it('rota do torcedor sem config.age não sobe; com a capacidade ou exempt, sobe', async () => {
    const app = buildServer({ usage: false, fanTokens: signer });
    expect(() => app.get('/v1/fans/me/esquecida', { config: { fan: true } }, async () => ({}))).toThrow(
      /config\.age/,
    );
    expect(() =>
      app.get('/v1/fans/me/errada', { config: { fan: true, age: 'tudo' as never } }, async () => ({})),
    ).toThrow(/config\.age/);
    app.get('/v1/fans/me/lida', { config: { fan: true, age: 'read' } }, async () => ({}));
    app.get('/v1/fans/me/estado', { config: { fan: true, age: 'exempt' } }, async () => ({}));
    await app.ready();
    await app.close();
  });

  it('menor de 13 no token é recusado sem consultar o banco, com o motivo', async () => {
    const app = buildServer({ usage: false, fanTokens: signer, fanRevocations: new MemoryFanRevocations() });
    const { token } = signer.issue(claims({ ageBand: 'under13' }), 900);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/fans/me/wallet',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FAN_AGE_RESTRICTED', age_gate: { reason: 'under_min_age' } });
    await app.close();
  });
});
