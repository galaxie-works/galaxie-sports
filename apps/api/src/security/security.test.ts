import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { generateAdminKey, hashAdminKey } from '../admin/guard.js';
import { parsePlans } from '../admin/plans.js';
import { isPublishableRoute } from '../auth/publishable.js';
import { hardeningFromEnv } from '../config.js';
import { buildServer } from '../server.js';
import { memoryTenant } from '../test-helpers.js';
import { normalizeOrigin } from './cors.js';

const PLANS = parsePlans({
  plans: Object.fromEntries(
    ['core_data', 'fan_experience', 'live_intelligence', 'enterprise'].map((p) => [
      p,
      { name: p, modules: ['core_data'], rateLimitPerMinute: 60 },
    ]),
  ),
});

describe('headers de segurança', () => {
  it('aplica nosniff, frame DENY, CSP estrita e no-referrer em JSON, erros e 404', async () => {
    const app = buildServer({ security: { hstsMaxAgeSec: 31_536_000 } });
    for (const url of ['/health', '/v1/sports', '/nao-existe']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('a referência /docs carrega scripts do CDN: CSP só bloqueia enquadramento', async () => {
    const res = await buildServer().inject({ method: 'GET', url: '/docs' });
    expect(res.headers['content-security-policy']).toBe(
      "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('CORS estrito', () => {
  const app = buildServer({ cors: { origins: ['https://app.exemplo.test'] } });

  it('libera só a origem configurada, sem credenciais, expondo os headers da API', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.exemplo.test' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.exemplo.test');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    expect(ok.headers['access-control-expose-headers']).toContain('x-ratelimit-remaining');
    expect(ok.headers.vary).toContain('Origin');
    const other = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://mal.test' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight: 204 com métodos e headers permitidos; método não permitido sem allow-methods', async () => {
    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/v1/sports',
      headers: { origin: 'https://app.exemplo.test', 'access-control-request-method': 'GET' },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toBe('GET, HEAD, POST');
    expect(pre.headers['access-control-allow-headers']).toContain('x-galaxie-key');
    const del = await app.inject({
      method: 'OPTIONS',
      url: '/v1/sports',
      headers: { origin: 'https://app.exemplo.test', 'access-control-request-method': 'DELETE' },
    });
    expect(del.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('rotas /internal nunca recebem CORS', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/internal/admin/plans',
      headers: { origin: 'https://app.exemplo.test', 'access-control-request-method': 'GET' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sem CORS_ORIGINS não há headers CORS', async () => {
    const res = await buildServer().inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://x.test' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('normaliza origens e rejeita valores com caminho ou esquema estranho', () => {
    expect(normalizeOrigin('HTTPS://App.Exemplo.test')).toBe('https://app.exemplo.test');
    expect(normalizeOrigin('https://a.test/caminho')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(() => buildServer({ cors: { origins: ['nao-e-url'] } })).toThrow(/CORS_ORIGINS/);
  });
});

describe('limites de requisição', () => {
  it('corpo acima do limite → 413 em problem+json', async () => {
    const { store, key } = await memoryTenant();
    const app = buildServer({ tenantStore: store, bodyLimit: 1024 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/account/keys/rotate',
      headers: { 'x-galaxie-key': key, 'content-type': 'application/json' },
      payload: JSON.stringify({ graceSeconds: 1, pad: 'x'.repeat(4096) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('espelho: query com parâmetros demais ou valores enormes → 400', async () => {
    const { store, key } = await memoryTenant();
    const app = buildServer({ tenantStore: store });
    const many = Array.from({ length: 21 }, (_, i) => `p${i}=1`).join('&');
    const a = await app.inject({
      method: 'GET',
      url: `/mirror/football/fixtures?${many}`,
      headers: { 'x-galaxie-key': key },
    });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({
      method: 'GET',
      url: `/mirror/football/fixtures?league=${'9'.repeat(300)}`,
      headers: { 'x-galaxie-key': key },
    });
    expect(b.statusCode).toBe(400);
  });
});

describe('auditoria de rotas', () => {
  // Rotas públicas por decisão explícita; qualquer rota nova fora daqui precisa declarar
  // config.module, config.authenticated ou config.admin.
  // /metrics: protegido por METRICS_TOKEN (Bearer) e não exposto pelo proxy público.
  const PUBLIC = new Set([
    'GET /health',
    'GET /health/db',
    'GET /metrics',
    'GET /openapi.json',
    'GET /docs',
    'OPTIONS /*',
  ]);

  it('toda rota é pública por decisão explícita ou exige chave (tenant ou admin)', async () => {
    const { store } = await memoryTenant();
    const app = buildServer({
      tenantStore: store,
      db: {} as Database,
      usage: false,
      cors: { origins: ['https://app.exemplo.test'] },
      admin: { keyHashes: [hashAdminKey(generateAdminKey())], plans: PLANS },
    });
    await app.ready();
    const routes = app.routeTable.filter((r) => r.method !== 'HEAD');
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      const id = `${r.method} ${r.url}`;
      if (PUBLIC.has(id)) continue;
      const declared = Boolean(r.config.module || r.config.authenticated || r.config.admin);
      expect(declared, `${id} não declara autenticação`).toBe(true);
      const url = r.url.replace(/:(\w+)/g, '0').replace('*', 'fixtures');
      const res = await app.inject({
        method: r.method as 'GET',
        url,
        ...(r.method === 'GET' ? {} : { payload: {} }),
      });
      expect(res.statusCode, `${id} sem chave respondeu ${res.statusCode}`).toBe(401);
    }
    await app.close();
  });
});

describe('OpenAPI × rotas', () => {
  it('declara a chave publicável exatamente nas operações que a API aceita com ela', async () => {
    const app = buildServer({ usage: false });
    await app.ready();
    const doc = buildOpenApiDocument();
    const publishable = (op: { security?: Record<string, unknown>[] } | undefined) =>
      Boolean(op?.security?.some((s) => 'galaxiePublishableKey' in s));
    let checked = 0;
    for (const r of app.routeTable) {
      const path = r.url.replace(/:(\w+)/g, '{$1}');
      const item = doc.paths?.[path] as Record<string, { security?: Record<string, unknown>[] }> | undefined;
      const op = item?.[r.method.toLowerCase()];
      if (!op) continue;
      checked++;
      expect(publishable(op), `${r.method} ${r.url}`).toBe(isPublishableRoute(r.method, r.url, r.config));
    }
    expect(checked).toBeGreaterThan(40);
    await app.close();
  });
});

describe('configuração por ambiente', () => {
  it('lê CORS, admin, proxy e limites', () => {
    const cfg = hardeningFromEnv({
      CORS_ORIGINS: 'https://a.test, https://b.test',
      ADMIN_KEY_HASHES: 'sha256$x,sha256$y',
      ADMIN_IP_ALLOWLIST: '10.0.0.0/8',
      TRUST_PROXY: '10.0.0.1,10.0.0.2',
      API_BODY_LIMIT: '32768',
      HSTS_MAX_AGE: '31536000',
    });
    expect(cfg).toMatchObject({
      cors: { origins: ['https://a.test', 'https://b.test'] },
      admin: { keyHashes: ['sha256$x', 'sha256$y'], ipAllowlist: ['10.0.0.0/8'] },
      trustProxy: ['10.0.0.1', '10.0.0.2'],
      bodyLimit: 32768,
      security: { hstsMaxAgeSec: 31536000 },
    });
    expect(hardeningFromEnv({})).toEqual({});
    expect(hardeningFromEnv({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(() => hardeningFromEnv({ API_BODY_LIMIT: 'muito' })).toThrow(/API_BODY_LIMIT/);
  });
});
