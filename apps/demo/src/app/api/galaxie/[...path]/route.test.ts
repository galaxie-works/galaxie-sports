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

describe('proxy /api/galaxie: escrita do chat (#977)', () => {
  const ROOM = '0190f000-0000-7000-8000-00000000f001';
  const post = (path: string[], headers: Record<string, string> = {}) =>
    route.POST(
      new Request(`http://demo.test/api/galaxie/${path.join('/')}`, {
        method: 'POST',
        body: JSON.stringify({ body: 'Vamos!' }),
        headers: {
          cookie: 'better-auth.session_token=sessao-a.assinatura',
          'sec-fetch-site': 'same-origin',
          authorization: 'Bearer gft_abc.def',
          ...headers,
        },
      }),
      { params: Promise.resolve({ path }) },
    );

  it('repassa a mensagem e a reação com o token do torcedor, sem a chave da demo', async () => {
    for (const kind of ['messages', 'reactions']) {
      upstream.mockClear();
      const res = await post(['v1', 'chat', 'rooms', ROOM, kind]);
      expect(res.status).toBe(200);
      const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toBe(`http://api.test/v1/chat/rooms/${ROOM}/${kind}`);
      const headers = new Headers(init.headers);
      expect(headers.get('authorization')).toBe('Bearer gft_abc.def');
      expect(headers.get('x-galaxie-key')).toBeNull();
      expect(init.method).toBe('POST');
    }
  });

  it('recusa outro caminho, outra origem e pedido sem o token, sem chamar a API', async () => {
    expect((await post(['v1', 'chat', 'config'])).status).toBe(404);
    expect((await post(['v1', 'chat', 'rooms', 'nao-uuid', 'messages'])).status).toBe(404);
    expect((await post(['v1', 'fans', 'tokens'])).status).toBe(404);
    expect(
      (await post(['v1', 'chat', 'rooms', ROOM, 'messages'], { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(404);
    expect(
      (await post(['v1', 'chat', 'rooms', ROOM, 'messages'], { authorization: 'Bearer gs_sk_x' })).status,
    ).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('a leitura da sala e o stream passam pelo GET', async () => {
    expect((await get(['v1', 'chat', 'rooms', ROOM])).status).toBe(200);
    expect((await get(['v1', 'chat', 'rooms', ROOM, 'stream'])).status).toBe(200);
  });
});
