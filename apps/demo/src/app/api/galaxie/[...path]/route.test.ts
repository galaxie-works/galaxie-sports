import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROXY_REQUESTS_PER_MINUTE } from '@/lib/galaxie/proxy-policy';

/* Proxy /api/galaxie/* com a API falsa (fetch): o que passa, o que não passa e o teto por sessão. */

vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));

/** O token do torcedor sai da sessão (#1369): aqui, um falso por padrão válido. */
const sessionFan = vi.fn(
  async (): Promise<
    { ok: true; authorization: string; userId: string } | { ok: false; status: 401 | 502 | 503 }
  > => ({
    ok: true,
    authorization: 'Bearer gft_sessao.x',
    userId: 'u1',
  }),
);
const dropFan = vi.fn();
vi.mock('@/lib/fan/session-token', () => ({
  sessionFanAuthorization: () => sessionFan(),
  dropSessionFanToken: (...a: unknown[]) => dropFan(...a),
}));

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
  sessionFan.mockClear();
  dropFan.mockClear();
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

  it('repassa a mensagem e a reação com o token da sessão (não o do navegador), sem a chave da demo', async () => {
    for (const kind of ['messages', 'reactions']) {
      upstream.mockClear();
      const res = await post(['v1', 'chat', 'rooms', ROOM, kind]);
      expect(res.status).toBe(200);
      const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toBe(`http://api.test/v1/chat/rooms/${ROOM}/${kind}`);
      const headers = new Headers(init.headers);
      expect(headers.get('authorization')).toBe('Bearer gft_sessao.x');
      expect(headers.get('x-galaxie-key')).toBeNull();
      expect(init.method).toBe('POST');
    }
  });

  it('recusa outro caminho, outra origem e sessão sem token de torcedor, sem chamar a API', async () => {
    expect((await post(['v1', 'chat', 'config'])).status).toBe(404);
    expect((await post(['v1', 'chat', 'rooms', 'nao-uuid', 'messages'])).status).toBe(404);
    expect((await post(['v1', 'fans', 'tokens'])).status).toBe(404);
    expect(
      (await post(['v1', 'chat', 'rooms', ROOM, 'messages'], { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(404);
    sessionFan.mockResolvedValueOnce({ ok: false, status: 401 });
    expect((await post(['v1', 'chat', 'rooms', ROOM, 'messages'])).status).toBe(401);
    sessionFan.mockResolvedValueOnce({ ok: false, status: 503 });
    expect((await post(['v1', 'chat', 'rooms', ROOM, 'messages'])).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('a API recusou o token da sessão (401): descarta do cache para o próximo pedido emitir outro', async () => {
    upstream.mockImplementationOnce(async () => Response.json({}, { status: 401 }) as never);
    expect((await post(['v1', 'chat', 'rooms', ROOM, 'messages'])).status).toBe(401);
    expect(dropFan).toHaveBeenCalledWith('u1', 'Bearer gft_sessao.x');
    upstream.mockImplementationOnce(async () => Response.json({}, { status: 403 }) as never);
    await post(['v1', 'chat', 'rooms', ROOM, 'messages']);
    expect(dropFan).toHaveBeenCalledTimes(1);
  });

  it('a leitura da sala e o stream passam pelo GET', async () => {
    expect((await get(['v1', 'chat', 'rooms', ROOM])).status).toBe(200);
    expect((await get(['v1', 'chat', 'rooms', ROOM, 'stream'])).status).toBe(200);
  });
});

describe('proxy /api/galaxie: torcedor e stream do chat (#977)', () => {
  const ROOM = '0190f000-0000-7000-8000-00000000f001';
  const fanGet = (path: string[], headers: Record<string, string> = {}) =>
    route.GET(
      new Request(`http://demo.test/api/galaxie/${path.join('/')}`, {
        headers: {
          cookie: 'better-auth.session_token=sessao-f.assinatura',
          'sec-fetch-site': 'same-origin',
          ...headers,
        },
      }),
      { params: Promise.resolve({ path }) },
    );

  it('o Perfil do torcedor vai com o token da sessão e sem a chave da demo', async () => {
    const res = await fanGet(['v1', 'fans', 'me'], { authorization: 'Bearer gft_de.outra_pessoa' });
    expect(res.status).toBe(200);
    const [, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer gft_sessao.x');
    expect(headers.get('x-galaxie-key')).toBeNull();
  });

  it('sem o token, de outra origem ou em outra rota do torcedor: recusa sem chamar a API', async () => {
    sessionFan.mockResolvedValueOnce({ ok: false, status: 401 });
    expect((await fanGet(['v1', 'fans', 'me'])).status).toBe(401);
    expect(
      (
        await fanGet(['v1', 'fans', 'me'], {
          authorization: 'Bearer gft_a.b',
          'sec-fetch-site': 'cross-site',
        })
      ).status,
    ).toBe(404);
    expect((await fanGet(['v1', 'fans', 'tokens'], { authorization: 'Bearer gft_a.b' })).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('a configuração do chat do tenant não passa (só a sala e o stream)', async () => {
    expect((await get(['v1', 'chat', 'config'])).status).toBe(404);
    expect((await get(['v1', 'chat', 'rooms', 'nao-uuid'])).status).toBe(404);
    expect((await get(['v1', 'chat', 'rooms', ROOM, 'messages'])).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('teto de streams do chat abertos por sessão; a vaga volta quando o stream fecha', async () => {
    upstream.mockImplementation(
      async () =>
        new Response('event: ready\ndata: {}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }) as never,
    );
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const open = (signal?: AbortSignal) =>
      route.GET(
        new Request(`http://demo.test/api/galaxie/v1/chat/rooms/${ROOM}/stream`, {
          headers: { cookie: 'better-auth.session_token=sessao-s.assinatura' },
          ...(signal ? { signal } : {}),
        }),
        { params: Promise.resolve({ path: ['v1', 'chat', 'rooms', ROOM, 'stream'] }) },
      );
    for (const c of controllers) expect((await open(c.signal)).status).toBe(200);
    expect((await open()).status).toBe(429);
    controllers[0]!.abort();
    expect((await open()).status).toBe(200);
  });

  it('corpo grande demais: 413 antes de chamar a API', async () => {
    const res = await route.POST(
      new Request(`http://demo.test/api/galaxie/v1/chat/rooms/${ROOM}/messages`, {
        method: 'POST',
        body: 'x'.repeat(9_000),
        headers: {
          cookie: 'better-auth.session_token=sessao-a.assinatura',
          'sec-fetch-site': 'same-origin',
          authorization: 'Bearer gft_abc.def',
        },
      }),
      { params: Promise.resolve({ path: ['v1', 'chat', 'rooms', ROOM, 'messages'] }) },
    );
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
});
