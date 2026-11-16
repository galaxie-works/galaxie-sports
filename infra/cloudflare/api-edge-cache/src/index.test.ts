import { describe, expect, it, vi } from 'vitest';
import { handle, type Deps, type EdgeCache } from './index.js';

const API = 'https://api.galaxiesports.com';
const KEY = 'chave-de-teste';

/** Cache API em memória: guarda por URL, como o `caches.default` (sem TTL; o teste não precisa). */
class MemoryCache implements EdgeCache {
  readonly entries = new Map<string, { body: string; init: ResponseInit; headers: Headers }>();
  async match(request: Request): Promise<Response | undefined> {
    const e = this.entries.get(request.url);
    return e ? new Response(e.body, { ...e.init, headers: e.headers }) : undefined;
  }
  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, {
      body: await response.text(),
      init: { status: response.status },
      headers: new Headers(response.headers),
    });
  }
}

function setup(originResponse: (request: Request) => Response) {
  const cache = new MemoryCache();
  const pending: Promise<unknown>[] = [];
  const seen: Request[] = [];
  const deps: Deps = {
    cache,
    fetch: vi.fn(async (request: Request) => {
      seen.push(request);
      return originResponse(request);
    }),
    waitUntil: (p) => pending.push(p),
  };
  const run = async (request: Request) => {
    const res = await handle(request, deps);
    await Promise.all(pending);
    return res;
  };
  return { cache, seen, run, deps };
}

const catalog = () =>
  new Response(JSON.stringify({ data: [1] }), {
    headers: {
      'content-type': 'application/json',
      etag: '"v1"',
      'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=60',
      vary: 'Accept-Language, x-galaxie-key, x-galaxie-publishable-key, Origin',
      'surrogate-key': 'competition competition:1',
      'x-galaxie-edge-ttl': '900',
      'x-ratelimit-remaining': '59',
    },
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${API}${path}`, { headers: { 'x-galaxie-key': KEY, ...headers } });

describe('Worker de cache de borda', () => {
  it('MISS guarda a resposta marcada; HIT serve da borda sem ir à origem', async () => {
    const { cache, seen, run } = setup(catalog);
    const first = await run(get('/v1/competitions'));
    expect(first.status).toBe(200);
    expect(first.headers.get('x-galaxie-edge-cache')).toBe('MISS');
    expect(first.headers.get('x-galaxie-edge-ttl')).toBeNull();
    expect(cache.entries.size).toBe(1);
    const stored = [...cache.entries.values()][0]!;
    expect(stored.headers.get('cache-tag')).toBe('competition,competition:1');
    expect(stored.headers.get('cache-control')).toBe('public, max-age=900');
    expect(stored.headers.get('x-ratelimit-remaining')).toBeNull();

    const second = await run(get('/v1/competitions'));
    expect(second.headers.get('x-galaxie-edge-cache')).toBe('HIT');
    expect(await second.json()).toEqual({ data: [1] });
    expect(second.headers.get('cache-control')).toBe(
      'public, max-age=300, s-maxage=86400, stale-while-revalidate=60',
    );
    expect(second.headers.get('cache-tag')).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('a cópia de uma chave nunca serve outra chave, outro idioma ou quem não tem chave', async () => {
    const { seen, run } = setup(catalog);
    await run(get('/v1/competitions'));
    await run(get('/v1/competitions', { 'x-galaxie-key': `${KEY}-outra` }));
    await run(get('/v1/competitions', { 'accept-language': 'en' }));
    const anon = await run(new Request(`${API}/v1/competitions`));
    expect(anon.headers.get('x-galaxie-edge-cache')).toBeNull();
    expect(seen).toHaveLength(4);
  });

  it('sem chave passa direto e não grava nada', async () => {
    const { cache, run } = setup(catalog);
    await run(new Request(`${API}/v1/competitions`));
    expect(cache.entries.size).toBe(0);
  });

  it('resposta sem marca (ao vivo, agenda, erro) não é guardada', async () => {
    const live = () =>
      new Response('{}', {
        headers: { 'cache-control': 'public, max-age=10, s-maxage=10', 'surrogate-key': 'event' },
      });
    const { cache, seen, run } = setup(live);
    await run(get('/v1/events/1'));
    await run(get('/v1/events/1'));
    expect(cache.entries.size).toBe(0);
    expect(seen).toHaveLength(2);

    const forbidden = setup(
      () => new Response('{}', { status: 403, headers: { 'x-galaxie-edge-ttl': '900' } }),
    );
    await forbidden.run(get('/v1/events/1'));
    expect(forbidden.cache.entries.size).toBe(0);
  });

  it('sem tags não guarda: o purge não alcançaria a cópia', async () => {
    const noTags = () =>
      new Response('{}', {
        headers: { 'cache-control': 'public, max-age=300', 'x-galaxie-edge-ttl': '900' },
      });
    const { cache, run } = setup(noTags);
    await run(get('/v1/competitions'));
    expect(cache.entries.size).toBe(0);
  });

  it('If-None-Match: 304 da borda e da origem; a origem recebe a requisição sem o condicional', async () => {
    const { seen, run } = setup(catalog);
    const miss = await run(get('/v1/competitions', { 'if-none-match': '"v1"' }));
    expect(miss.status).toBe(304);
    expect(seen[0]!.headers.get('if-none-match')).toBeNull();
    const hit = await run(get('/v1/competitions', { 'if-none-match': 'W/"v1"' }));
    expect(hit.status).toBe(304);
    expect(hit.headers.get('etag')).toBe('"v1"');
    expect(seen).toHaveLength(1);
  });

  it('SSE, escrita e token do torcedor passam direto, com IP e país do cliente', async () => {
    const { cache, seen, run } = setup(() => new Response('ok'));
    const sse = new Request(`${API}/v1/stream`, {
      headers: { 'x-galaxie-key': KEY, 'cf-connecting-ip': '203.0.113.7' },
    });
    Object.defineProperty(sse, 'cf', { value: { country: 'BR' } });
    await run(sse);
    expect(seen[0]!.headers.get('x-real-ip')).toBe('203.0.113.7');
    expect(seen[0]!.headers.get('cf-ipcountry')).toBe('BR');
    await run(
      new Request(`${API}/v1/fans/me`, { method: 'POST', body: '{}', headers: { 'x-galaxie-key': KEY } }),
    );
    expect(await seen[1]!.text()).toBe('{}');
    await run(get('/v1/competitions', { authorization: 'Bearer gft_x' }));
    expect(cache.entries.size).toBe(0);
  });

  it('falha da Cache API vira MISS, sem derrubar a requisição', async () => {
    const { deps } = setup(catalog);
    deps.cache = {
      match: () => Promise.reject(new Error('cache fora')),
      put: () => Promise.reject(new Error('cache fora')),
    };
    const res = await handle(get('/v1/competitions'), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-galaxie-edge-cache')).toBe('MISS');
  });
});
