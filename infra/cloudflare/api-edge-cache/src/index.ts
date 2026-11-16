import {
  bypassReason,
  cacheKeyUrl,
  edgeTtlOf,
  matchesEtag,
  originHeaders,
  servedHeaders,
  storedHeaders,
  tagsOf,
} from './edge.js';

/** A parte da Cache API dos Workers que o handler usa (`caches.default`). */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface Deps {
  cache: EdgeCache;
  fetch: (request: Request) => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** Requisição que chega ao Worker, com o `cf` do runtime (país do cliente). */
type IncomingRequest = Request & { cf?: { country?: string } };

/** 304 quando o If-None-Match do cliente casa com o ETag da resposta (da borda ou da origem). */
function respond(request: Request, response: Response, headers: Headers): Response {
  if (matchesEtag(request.headers.get('if-none-match'), headers.get('etag'))) {
    void response.body?.cancel();
    return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Cache de borda da API (#1257), na rota `api.galaxiesports.com/v1/*`:
 * 1. passa direto (sem olhar nem gravar a borda) o que não é GET, o SSE, o token do torcedor e o que vem sem chave;
 * 2. procura a cópia pela chave URL + SHA-256 da chave da API + locale + origem da página;
 * 3. sem cópia, busca na origem (com o IP e o país do cliente) e guarda só o que a origem marcou com
 *    `x-galaxie-edge-ttl`, com o `Cache-Tag` para o purge por tag.
 * Falha da Cache API nunca derruba a requisição: vira MISS.
 */
export async function handle(request: IncomingRequest, deps: Deps): Promise<Response> {
  const country = request.cf?.country;
  const bypass = bypassReason(request);
  if (bypass) return deps.fetch(new Request(request, { headers: originHeaders(request, country, false) }));

  const key = new Request(await cacheKeyUrl(request), { method: 'GET' });
  const cached = await deps.cache.match(key).catch(() => undefined);
  if (cached) return respond(request, cached, servedHeaders(cached.headers, 'HIT'));

  const response = await deps.fetch(new Request(request, { headers: originHeaders(request, country, true) }));
  const ttl = edgeTtlOf(response);
  const tags = ttl ? tagsOf(response.headers) : [];
  if (ttl && tags.length) {
    const copy = response.clone();
    deps.waitUntil(
      deps.cache
        .put(key, new Response(copy.body, { status: 200, headers: storedHeaders(copy.headers, ttl, tags) }))
        .catch(() => undefined),
    );
  }
  return respond(request, response, servedHeaders(response.headers, 'MISS'));
}

export default {
  async fetch(request: IncomingRequest, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const cache = (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
    return handle(request, { cache, fetch: (r) => fetch(r), waitUntil: (p) => ctx.waitUntil(p) });
  },
};
