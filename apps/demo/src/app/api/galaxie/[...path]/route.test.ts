import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROXY_REQUESTS_PER_MINUTE } from '@/lib/galaxie/proxy-policy';

/* Proxy /api/galaxie/* com a API falsa (fetch): o que passa, o que não passa e o teto por sessão. */

vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));

const upstream = vi.fn(async (url: URL) =>
  Response.json({ data: [], url: url.toString() }, { headers: { 'content-type': 'application/json' } }),
);

let route: typeof import('./route');

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('GALAXIE_API_URL', 'http://api.test');
  vi.stubEnv('GALAXIE_DEMO_KEY', 'gs_demo_chave');
  vi.stubGlobal('fetch', upstream);
  upstream.mockClear();
  route = await import('./route');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const get = (path: string[], session = 'sessao-a') =>
  route.GET(
    new Request(`http://demo.test/api/galaxie/${path.join('/')}?q=x&key=forjada`, {
      headers: { cookie: `better-auth.session_token=${session}.assinatura` },
    }),
    { params: Promise.resolve({ path }) },
  );

describe('proxy /api/galaxie', () => {
  it('repassa as leituras que o app usa, com a chave do servidor (nunca a da URL)', async () => {
    for (const path of [
      ['v1', 'search'],
      ['v1', 'teams', '1', 'overview'],
      ['v1', 'events', 'live'],
      ['v1', 'stream'],
      ['v1', 'sports', 'formula-1', 'legends'],
    ]) {
      expect((await get(path)).status, path.join('/')).toBe(200);
    }
    const [url] = upstream.mock.calls.at(-1)!;
    expect(url.toString()).toBe('http://api.test/v1/sports/formula-1/legends?q=x');
  });

  it('recusa conta, lista de canais e o que não é leitura do app, sem chamar a API', async () => {
    for (const path of [
      ['v1', 'account'],
      ['v1', 'account', 'keys'],
      ['v1', 'account', 'usage'],
      ['v1', 'channel-list'],
      ['v1', 'related', 'playback-errors'],
      ['v1'],
      ['mirror', 'football', 'fixtures'],
      ['v1', '..', 'internal'],
      ['v1', 'teams', '..', '..', 'internal'],
      ['v1', 'teams/../../account'],
    ]) {
      expect((await get(path)).status, path.join('/')).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('teto por sessão: passou, 429 com Retry-After; outra sessão segue livre', async () => {
    for (let i = 0; i < PROXY_REQUESTS_PER_MINUTE; i++)
      expect((await get(['v1', 'search'])).status).toBe(200);
    const blocked = await get(['v1', 'search']);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await get(['v1', 'search'], 'sessao-b')).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(PROXY_REQUESTS_PER_MINUTE + 1);
  });
});
