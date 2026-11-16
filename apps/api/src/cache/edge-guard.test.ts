import { describe, expect, it } from 'vitest';
import { API_PLANS, type Database } from '@galaxie/db';
import { EDGE_MAX_TTL_SEC, EDGE_TTL_HEADER, isEdgeEligible } from './edge.js';
import { cacheControl } from './policy.js';
import { generateAdminKey, hashAdminKey } from '../admin/guard.js';
import { parsePlans } from '../admin/plans.js';
import { problems } from '../errors.js';
import { buildServer } from '../server.js';
import { memoryTenant } from '../test-helpers.js';

const PLANS = parsePlans({
  plans: Object.fromEntries(
    [...API_PLANS].map((p) => [p, { name: p, modules: ['core_data'], rateLimitPerMinute: 60 }]),
  ),
});

/**
 * Teste de guarda do cache de borda (#1257): nenhuma resposta no-store, de erro, de /internal, admin ou SSE sai com a
 * marca que o Worker da Cloudflare usa para guardar a cópia, nem quando uma rota a põe por engano.
 */
describe('guarda da marca da borda', () => {
  function app() {
    const a = buildServer({ usage: false });
    // rota de teste que sempre põe a marca: o hook do servidor decide se ela sai
    const handler = async (
      request: { query: unknown },
      reply: {
        header: (k: string, v: string) => unknown;
        code: (n: number) => { send: (b: unknown) => unknown };
      },
    ) => {
      const q = request.query as { status?: string; cc?: string; ttl?: string; throw?: string };
      reply.header('cache-control', q.cc ?? cacheControl(86_400));
      reply.header(EDGE_TTL_HEADER, q.ttl ?? '600');
      if (q.throw) throw problems.rateLimited(30);
      return reply.code(Number(q.status ?? 200)).send({ ok: true });
    };
    a.get('/v1/edge-test', handler as never);
    a.get('/v1/edge-test/stream', handler as never);
    a.get('/internal/edge-test', handler as never);
    a.get('/internal/admin/edge-test', handler as never);
    a.get('/mirror/edge-test', handler as never);
    a.post('/v1/edge-test', handler as never);
    return a;
  }

  it('resposta elegível mantém a marca, com o teto aplicado', async () => {
    const a = app();
    expect((await a.inject({ url: '/v1/edge-test' })).headers[EDGE_TTL_HEADER]).toBe('600');
    expect((await a.inject({ url: '/v1/edge-test?ttl=86400' })).headers[EDGE_TTL_HEADER]).toBe(
      String(EDGE_MAX_TTL_SEC),
    );
  });

  it.each([
    ['401', '/v1/edge-test?status=401'],
    ['403', '/v1/edge-test?status=403'],
    ['404', '/v1/edge-test?status=404'],
    ['429', '/v1/edge-test?status=429'],
    ['500', '/v1/edge-test?status=500'],
    ['503', '/v1/edge-test?status=503'],
    ['erro lançado (429)', '/v1/edge-test?throw=1'],
    ['no-store', '/v1/edge-test?cc=no-store'],
    ['private', '/v1/edge-test?cc=private,max-age=60'],
    ['valor inválido', '/v1/edge-test?ttl=x'],
    ['SSE', '/v1/edge-test/stream'],
    ['/internal', '/internal/edge-test'],
    ['admin', '/internal/admin/edge-test'],
    ['espelho', '/mirror/edge-test'],
  ])('%s sai sem a marca', async (_name, url) => {
    const res = await app().inject({ url });
    expect(res.headers[EDGE_TTL_HEADER]).toBeUndefined();
  });

  it('escrita e token do torcedor saem sem a marca', async () => {
    const a = app();
    expect(
      (await a.inject({ method: 'POST', url: '/v1/edge-test', payload: {} })).headers[EDGE_TTL_HEADER],
    ).toBe(undefined);
    const fan = await a.inject({ url: '/v1/edge-test', headers: { authorization: 'Bearer gft_x' } });
    expect(fan.headers[EDGE_TTL_HEADER]).toBeUndefined();
  });

  it('toda rota de /internal, admin, espelho, SSE, torcedor ou escrita fica fora da borda, e nenhum erro leva a marca', async () => {
    const { store } = await memoryTenant();
    const a = buildServer({
      tenantStore: store,
      db: {} as Database,
      usage: false,
      admin: { keyHashes: [hashAdminKey(generateAdminKey())], plans: PLANS },
    });
    await a.ready();
    const routes = a.routeTable.filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS');
    expect(routes.some((r) => r.url.startsWith('/internal/admin'))).toBe(true);
    expect(routes.some((r) => r.url.includes('stream'))).toBe(true);
    let outside = 0;
    for (const r of routes) {
      const url = r.url.replace(/:(\w+)/g, '0').replace('*', 'fixtures');
      const mustStayOut =
        r.method !== 'GET' ||
        !url.startsWith('/v1/') ||
        url.includes('stream') ||
        Boolean(r.config.admin || r.config.fan || r.config.allowQueryKey);
      if (mustStayOut) {
        outside++;
        expect(
          isEdgeEligible({
            method: r.method,
            url,
            status: 200,
            cacheControl: cacheControl(86_400),
            route: r.config,
          }),
          `${r.method} ${r.url}`,
        ).toBe(false);
      }
      // sem chave: erro (401, 403, 503...), e erro nunca leva a marca (só as rotas com chave: as públicas, como
      // /metrics e /health, leriam o banco falso deste teste)
      if (!/^\/(v1|internal|mirror)\//.test(url)) continue;
      const res = await a.inject({
        method: r.method as 'GET',
        url,
        ...(r.method === 'GET' ? {} : { payload: {} }),
      });
      expect(res.headers[EDGE_TTL_HEADER], `${r.method} ${r.url} → ${res.statusCode}`).toBeUndefined();
    }
    expect(outside).toBeGreaterThan(10);
    await a.close();
  });
});
