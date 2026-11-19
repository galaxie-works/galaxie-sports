/**
 * Proxy da API Galaxie Sports para o navegador da demo.
 *
 * - Leitura (`GET`): injeta a chave de demonstração no servidor e repassa o corpo em streaming (inclui o SSE de
 *   `/v1/stream` e o da sala do chat). Só os recursos de leitura que o app usa (`lib/galaxie/proxy-policy.ts`), com
 *   teto de pedidos por sessão e, no stream do chat, teto de conexões abertas por sessão.
 * - Torcedor (#977): `GET /v1/fans/me` e as escritas do chat (`POST` mensagem e reação) vão com o token `gft_` da
 *   pessoa logada e sem a chave da demo: a API autentica pelo token, e o proxy não fala em nome do tenant. O token
 *   sai da sessão, no servidor (#1369): o que o navegador manda no `Authorization` é ignorado. Só da própria demo,
 *   com balde próprio para as escritas.
 *
 * Se um dia a API exigir chave junto com o token nessas rotas, o 401 dela vira "sessão expirou" no widget (ele pede
 * outro token e desiste): a mudança teria de vir com a chave publicável da demo aqui.
 */
import { getSessionCookie } from 'better-auth/cookies';

import { dropSessionFanToken, sessionFanAuthorization } from '@/lib/fan/session-token';
import { isSameOrigin } from '@/lib/fan/token';
import {
  CHAT_STREAMS_PER_SESSION,
  createRateLimiter,
  isChatStream,
  isProxyFanRead,
  isProxyPathAllowed,
  isProxyWriteAllowed,
  PROXY_REQUESTS_PER_MINUTE,
  PROXY_WRITE_MAX_BYTES,
  PROXY_WRITES_PER_MINUTE,
} from '@/lib/galaxie/proxy-policy';
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
  'retry-after',
];

/** Teto por sessão (o proxy.ts já exigiu uma sessão válida para chegar aqui). */
const takeRequest = createRateLimiter(PROXY_REQUESTS_PER_MINUTE);
const takeWrite = createRateLimiter(PROXY_WRITES_PER_MINUTE);
/** Streams do chat abertos por sessão (a demo roda num processo só). */
const openStreams = new Map<string, number>();

const sessionOf = (request: Request) => getSessionCookie(request) ?? 'sem-sessao';
const common = async () => getDictionary(await getRequestLocale()).common;

function tooMany(title: string, retryAfter: number) {
  return Response.json({ title }, { status: 429, headers: { 'retry-after': String(retryAfter) } });
}

/** Sem token da sessão: 401 faz o widget pedir login ou perfil; a API fora do ar vira 502/503. */
async function fanRefused(status: 401 | 502 | 503) {
  const t = await common();
  if (status === 401) return Response.json({ title: t.fanTokenRequired }, { status: 401 });
  return Response.json({ title: t.apiUnavailable, detail: t.apiUnavailableDetail }, { status });
}

function relay(upstream: Response, body: ReadableStream<Uint8Array> | null = upstream.body) {
  const out = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (out.get('content-type')?.startsWith('text/event-stream')) {
    out.set('cache-control', 'no-cache, no-transform');
    out.set('x-accel-buffering', 'no');
  }
  return new Response(body, { status: upstream.status, headers: out });
}

export async function GET(request: Request, ctx: RouteContext<'/api/galaxie/[...path]'>) {
  const { path } = await ctx.params;
  const fanRead = isProxyFanRead(path);
  if (!fanRead && !isProxyPathAllowed(path))
    return Response.json({ title: (await common()).routeNotAllowed }, { status: 404 });
  const session = sessionOf(request);
  const retryAfter = takeRequest(session);
  if (retryAfter) return tooMany((await common()).tooManyRequests, retryAfter);

  const incoming = new URL(request.url);
  const target = new URL(`${API_URL}/${path.map(encodeURIComponent).join('/')}`);
  incoming.searchParams.forEach((v, k) => {
    // A chave nunca vem do navegador.
    if (k !== 'key') target.searchParams.append(k, v);
  });

  let headers: Headers;
  let fanToken: { userId: string; authorization: string } | null = null;
  if (fanRead) {
    // o Perfil do torcedor: com o token da pessoa da sessão, nunca com a chave da demo
    if (!isSameOrigin(request))
      return Response.json({ title: (await common()).routeNotAllowed }, { status: 404 });
    const fan = await sessionFanAuthorization(request);
    if (!fan.ok) return fanRefused(fan.status);
    fanToken = fan;
    headers = new Headers({ accept: 'application/json', authorization: fan.authorization });
    const lang = request.headers.get('accept-language');
    if (lang) headers.set('accept-language', lang);
  } else {
    headers = apiHeaders();
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
  }

  // stream do chat: no máximo CHAT_STREAMS_PER_SESSION abertos por sessão (o pico de conexões é do tenant da demo)
  const stream = isChatStream(path);
  let released = false;
  const release = () => {
    if (!stream || released) return;
    released = true;
    const n = (openStreams.get(session) ?? 1) - 1;
    if (n > 0) openStreams.set(session, n);
    else openStreams.delete(session);
  };
  if (stream) {
    const open = openStreams.get(session) ?? 0;
    if (open >= CHAT_STREAMS_PER_SESSION) return tooMany((await common()).tooManyRequests, 30);
    openStreams.set(session, open + 1);
    request.signal.addEventListener('abort', release, { once: true });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, signal: request.signal, cache: 'no-store' });
  } catch {
    release();
    const t = await common();
    return Response.json({ title: t.apiUnavailable, detail: t.apiUnavailableDetail }, { status: 502 });
  }
  // a API recusou o token guardado (perfil apagado, token revogado): o próximo pedido emite outro
  if (fanToken && upstream.status === 401) dropSessionFanToken(fanToken.userId, fanToken.authorization);
  // recusa da API (sem stream): a vaga volta já, sem esperar o navegador ler o corpo
  if (
    !stream ||
    !upstream.body ||
    !upstream.ok ||
    !(upstream.headers.get('content-type') ?? '').startsWith('text/event-stream')
  ) {
    release();
    return relay(upstream);
  }
  // a vaga do stream volta quando o corpo acaba (fim, erro ou o navegador fechou)
  const body = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush: release,
    }),
  );
  return relay(upstream, body);
}

/** Lê o corpo com corte em bytes; null se passar do limite. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * Escrita do chat ao vivo (#977): enviar mensagem e reagir, com o token do torcedor da pessoa logada
 * (o token sai da sessão, #1369; o `Authorization` do navegador não conta). A chave da demo não vai.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/galaxie/[...path]'>) {
  const { path } = await ctx.params;
  const t = await common();
  if (!isProxyWriteAllowed(path) || !isSameOrigin(request))
    return Response.json({ title: t.routeNotAllowed }, { status: 404 });
  const retryAfter = takeWrite(sessionOf(request));
  if (retryAfter) return tooMany(t.tooManyRequests, retryAfter);
  const body = await readCapped(request, PROXY_WRITE_MAX_BYTES);
  if (body === null) return Response.json({ title: t.bodyTooLarge }, { status: 413 });
  const fan = await sessionFanAuthorization(request);
  if (!fan.ok) return fanRefused(fan.status);
  const authorization = fan.authorization;

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
  // a API recusou o token guardado (perfil apagado, token revogado): o próximo pedido emite outro
  if (upstream.status === 401) dropSessionFanToken(fan.userId, authorization);
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of ['content-type', 'retry-after', 'x-request-id']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
