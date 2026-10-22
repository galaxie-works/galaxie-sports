/**
 * Proxy de leitura para a API Galaxie Sports: injeta a chave de demonstração no servidor e
 * repassa o corpo em streaming (inclui o SSE de `/v1/stream`). Só `GET /v1/*` passa.
 */
import { API_URL, apiHeaders } from '@/lib/galaxie/server';

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'if-none-match', 'last-event-id'];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  'content-language',
  'x-request-id',
];

export async function GET(request: Request, ctx: RouteContext<'/api/galaxie/[...path]'>) {
  const { path } = await ctx.params;
  if (path[0] !== 'v1' || path.some((p) => p === '..' || p === '')) {
    return Response.json({ title: 'Rota não permitida' }, { status: 404 });
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
    return Response.json(
      { title: 'API indisponível', detail: 'Não foi possível falar com a API Galaxie Sports.' },
      { status: 502 },
    );
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
