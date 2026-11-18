/**
 * Proxy de leitura para a API Galaxie Sports: injeta a chave de demonstração no servidor e
 * repassa o corpo em streaming (inclui o SSE de `/v1/stream`). Só `GET` dos recursos de leitura que o
 * app usa (`lib/galaxie/proxy-policy.ts`) passa, com teto de pedidos por sessão.
 */
import { getSessionCookie } from 'better-auth/cookies';

import {
  createRateLimiter,
  isProxyPathAllowed,
  isProxyWriteAllowed,
  PROXY_REQUESTS_PER_MINUTE,
} from '@/lib/galaxie/proxy-policy';
import { isSameOrigin } from '@/lib/fan/token';
import { API_URL, apiHeaders } from '@/lib/galaxie/server';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'if-none-match', 'last-event-id'];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  'content-language',
  'x-request-id',
];

/** Teto por sessão (o proxy.ts já exigiu uma sessão válida para chegar aqui). */
const takeRequest = createRateLimiter(PROXY_REQUESTS_PER_MINUTE);

export async function GET(request: Request, ctx: RouteContext<'/api/galaxie/[...path]'>) {
  const { path } = await ctx.params;
  if (!isProxyPathAllowed(path)) {
    const t = getDictionary(await getRequestLocale()).common;
    return Response.json({ title: t.routeNotAllowed }, { status: 404 });
  }
  const retryAfter = takeRequest(getSessionCookie(request) ?? 'sem-sessao');
  if (retryAfter) {
    const t = getDictionary(await getRequestLocale()).common;
    return Response.json(
      { title: t.tooManyRequests },
      { status: 429, headers: { 'retry-after': String(retryAfter) } },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(`${API_URL}/${path.map(encodeURIComponent).join('/')}`);
  incoming.searchParams.forEach((v, k) => {
    // A chave nunca vem do navegador.
    if (k !== 'key') target.searchParams.append(k, v);
  });

  const headers = apiHeaders();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, signal: request.signal, cache: 'no-store' });
  } catch {
    const t = getDictionary(await getRequestLocale()).common;
    return Response.json({ title: t.apiUnavailable, detail: t.apiUnavailableDetail }, { status: 502 });
  }

  const out = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (out.get('content-type')?.startsWith('text/event-stream')) {
    out.set('cache-control', 'no-cache, no-transform');
    out.set('x-accel-buffering', 'no');
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/**
 * Escrita do chat ao vivo (#977): enviar mensagem e reagir, com o token do torcedor da pessoa logada
 * (`Authorization: Bearer gft_…`, pedido pelo widget a `/api/fan/token`). A chave da demo não vai: a API autentica
 * pelo token, e o proxy não escreve em nome do tenant. Só da própria demo e com o mesmo teto por sessão.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/galaxie/[...path]'>) {
  const { path } = await ctx.params;
  const t = getDictionary(await getRequestLocale()).common;
  if (!isProxyWriteAllowed(path) || !isSameOrigin(request))
    return Response.json({ title: t.routeNotAllowed }, { status: 404 });
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer gft_[A-Za-z0-9._~+/=-]+$/.test(authorization) || authorization.length > 4096)
    return Response.json({ title: t.routeNotAllowed }, { status: 401 });
  const retryAfter = takeRequest(getSessionCookie(request) ?? 'sem-sessao');
  if (retryAfter)
    return Response.json(
      { title: t.tooManyRequests },
      { status: 429, headers: { 'retry-after': String(retryAfter) } },
    );
  const body = await request.text();
  if (body.length > 8_192) return Response.json({ title: t.routeNotAllowed }, { status: 413 });

  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    authorization,
  });
  const lang = request.headers.get('accept-language');
  if (lang) headers.set('accept-language', lang);
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/${path.map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers,
      body,
      signal: request.signal,
      cache: 'no-store',
    });
  } catch {
    return Response.json({ title: t.apiUnavailable, detail: t.apiUnavailableDetail }, { status: 502 });
  }
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of ['content-type', 'retry-after', 'x-request-id']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
