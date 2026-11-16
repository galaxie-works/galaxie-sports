import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  apiKeyOf,
  bypassReason,
  cacheKeyUrl,
  EDGE_MAX_TTL_SEC,
  EDGE_STATUS_HEADER,
  edgeTtlOf,
  matchesEtag,
  originHeaders,
  pageOrigin,
  resolveLocale,
  servedHeaders,
  sortedQuery,
  storedHeaders,
  SUPPORTED_LOCALES,
  tagsOf,
} from './edge.js';

const API = 'https://api.galaxiesports.com';
const KEY = 'chave-de-teste';

function req(path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`${API}${path}`, { method, headers });
}

describe('locale', () => {
  it('a lista é a mesma da API (packages/contracts)', () => {
    const src = readFileSync(
      new URL('../../../../packages/contracts/src/common.ts', import.meta.url),
      'utf8',
    );
    const block = /SUPPORTED_LOCALES = \[([^\]]+)\]/.exec(src)?.[1] ?? '';
    const api = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(api).toEqual([...SUPPORTED_LOCALES]);
  });

  it('reduz o Accept-Language ao locale que a API usaria', () => {
    expect(resolveLocale(null, 'es-AR,es;q=0.9,en;q=0.8')).toBe('es-AR');
    expect(resolveLocale(null, 'es-AR')).toBe('es-AR');
    expect(resolveLocale(null, 'es')).toBe('es-AR');
    expect(resolveLocale(null, 'es-ES')).toBe('es-AR');
    expect(resolveLocale(null, 'en-US,en;q=0.9')).toBe('en');
    expect(resolveLocale(null, 'pt-PT')).toBe('pt-BR');
    expect(resolveLocale(null, 'fr-FR')).toBe('pt-BR');
    expect(resolveLocale(null, 'fr;q=1, es-MX;q=0.5')).toBe('es-MX');
    expect(resolveLocale(null, null)).toBe('pt-BR');
  });

  it('?locale= válido vence o Accept-Language; inválido é ignorado', () => {
    expect(resolveLocale('es-CL', 'en')).toBe('es-CL');
    expect(resolveLocale('xx', 'en')).toBe('en');
  });
});

describe('bypassReason', () => {
  it('GET de /v1 com chave usa a borda', () => {
    expect(bypassReason(req('/v1/competitions', { 'x-galaxie-key': KEY }))).toBeUndefined();
    expect(
      bypassReason(req('/v1/competitions', { 'x-galaxie-publishable-key': 'pk_live_x' })),
    ).toBeUndefined();
  });

  it.each([
    ['sem chave', req('/v1/competitions'), 'no-key'],
    ['POST', req('/v1/fans/me', { 'x-galaxie-key': KEY }, 'POST'), 'method'],
    ['HEAD', req('/v1/competitions', { 'x-galaxie-key': KEY }, 'HEAD'), 'method'],
    ['SSE', req('/v1/stream', { 'x-galaxie-key': KEY }), 'stream'],
    ['SSE do chat', req('/v1/chat/rooms/1/stream', { 'x-galaxie-key': KEY }), 'stream'],
    [
      'token do torcedor',
      req('/v1/competitions', { 'x-galaxie-key': KEY, authorization: 'Bearer gft_x' }),
      'authorization',
    ],
    ['?token= do SSE', req('/v1/events/1?token=abc', { 'x-galaxie-key': KEY }), 'query-key'],
    ['?key=', req('/v1/events/1?key=abc'), 'query-key'],
    ['fora de /v1', req('/internal/admin/tenants', { 'x-galaxie-key': KEY }), 'path'],
  ])('%s passa direto', (_name, request, reason) => {
    expect(bypassReason(request)).toBe(reason);
  });

  it('a chave secreta vence a publicável, como na origem', () => {
    expect(apiKeyOf(new Headers({ 'x-galaxie-key': KEY, 'x-galaxie-publishable-key': 'pk' }))).toEqual({
      kind: 'secret',
      key: KEY,
    });
  });
});

describe('cacheKeyUrl', () => {
  const base = { 'x-galaxie-key': KEY, 'accept-language': 'es-AR' };

  it('não leva a chave em claro e separa por chave, idioma e origem', async () => {
    const k = await cacheKeyUrl(req('/v1/competitions?b=2&a=1', base));
    expect(k).not.toContain(KEY);
    expect(k).toMatch(
      /^https:\/\/api\.galaxiesports\.com\/__edge-cache\/s-[0-9a-f]{64}\/es-AR\/[0-9a-f]{32}\/v1\/competitions\?a=1&b=2$/,
    );
    const other = await cacheKeyUrl(req('/v1/competitions?a=1&b=2', { ...base, 'x-galaxie-key': `${KEY}x` }));
    expect(other).not.toBe(k);
    const en = await cacheKeyUrl(req('/v1/competitions?a=1&b=2', { ...base, 'accept-language': 'en-US' }));
    expect(en).not.toBe(k);
    const page = await cacheKeyUrl(req('/v1/competitions?a=1&b=2', { ...base, origin: 'https://a.example' }));
    expect(page).not.toBe(k);
  });

  it('mesma resposta da API → mesma cópia (ordem da query, variações do Accept-Language)', async () => {
    const a = await cacheKeyUrl(req('/v1/competitions?a=1&b=2', base));
    const b = await cacheKeyUrl(
      req('/v1/competitions?b=2&a=1', { ...base, 'accept-language': 'es-AR,es;q=0.9' }),
    );
    expect(b).toBe(a);
  });

  it('chave publicável e secreta com o mesmo valor não dividem cópia', async () => {
    const s = await cacheKeyUrl(req('/v1/x', { 'x-galaxie-key': 'k' }));
    const p = await cacheKeyUrl(req('/v1/x', { 'x-galaxie-publishable-key': 'k' }));
    expect(s).not.toBe(p);
  });

  it('só Referer não divide cópia com Origin da mesma página (a resposta sem Origin não leva CORS)', async () => {
    const comOrigin = await cacheKeyUrl(req('/v1/x', { 'x-galaxie-key': 'k', origin: 'https://b.example' }));
    const soReferer = await cacheKeyUrl(
      req('/v1/x', { 'x-galaxie-key': 'k', referer: 'https://b.example/jogo/1' }),
    );
    expect(comOrigin).not.toBe(soReferer);
  });

  it('origem da página: Origin, ou a do Referer', () => {
    expect(pageOrigin(new Headers({ origin: 'https://a.example' }))).toBe('https://a.example');
    expect(pageOrigin(new Headers({ referer: 'https://b.example/jogo/1?x=1' }))).toBe('https://b.example');
    expect(pageOrigin(new Headers({ referer: 'lixo' }))).toBe('');
  });

  it('query em ordem de nome, repetidos na ordem original', () => {
    expect(sortedQuery(new URL(`${API}/v1/x?z=1&a=2&a=1`))).toBe('?a=2&a=1&z=1');
    expect(sortedQuery(new URL(`${API}/v1/x`))).toBe('');
  });
});

describe('edgeTtlOf', () => {
  const headers = {
    'x-galaxie-edge-ttl': '600',
    'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=60',
  };

  it('guarda só o que a origem marcou, com o teto', () => {
    expect(edgeTtlOf(new Response('{}', { headers }))).toBe(600);
    expect(edgeTtlOf(new Response('{}', { headers: { ...headers, 'x-galaxie-edge-ttl': '86400' } }))).toBe(
      EDGE_MAX_TTL_SEC,
    );
  });

  it.each([
    ['sem marca', new Response('{}', { headers: { 'cache-control': headers['cache-control'] } })],
    ['401', new Response('{}', { status: 401, headers })],
    ['403', new Response('{}', { status: 403, headers })],
    ['429', new Response('{}', { status: 429, headers })],
    ['500', new Response('{}', { status: 500, headers })],
    ['no-store', new Response('{}', { headers: { ...headers, 'cache-control': 'no-store' } })],
    ['private', new Response('{}', { headers: { ...headers, 'cache-control': 'private' } })],
    ['Set-Cookie', new Response('{}', { headers: { ...headers, 'set-cookie': 'a=1' } })],
    ['Vary: *', new Response('{}', { headers: { ...headers, vary: '*' } })],
    ['marca inválida', new Response('{}', { headers: { ...headers, 'x-galaxie-edge-ttl': '-1' } })],
  ])('%s não vai à borda', (_name, response) => {
    expect(edgeTtlOf(response)).toBeUndefined();
  });
});

describe('tagsOf', () => {
  it('lê o Cache-Tag ou, sem ele, o surrogate-key', () => {
    expect(tagsOf(new Headers({ 'cache-tag': 'event,event:1', 'surrogate-key': 'x' }))).toEqual([
      'event',
      'event:1',
    ]);
    expect(tagsOf(new Headers({ 'surrogate-key': 'competition competition:1' }))).toEqual([
      'competition',
      'competition:1',
    ]);
    expect(tagsOf(new Headers())).toEqual([]);
  });

  it('respeita o limite de 16 KB do Cache-Tag', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `event:${String(i).padStart(10, '0')}`).join(' ');
    const tags = tagsOf(new Headers({ 'surrogate-key': many }));
    expect(tags.join(',').length).toBeLessThan(16 * 1024);
    expect(tags.length).toBeGreaterThan(900);
  });
});

describe('headers da cópia e da resposta', () => {
  const origin = new Headers({
    'content-type': 'application/json',
    etag: '"abc"',
    'cache-control': 'public, max-age=300, s-maxage=86400',
    vary: 'Accept-Language, x-galaxie-key, x-galaxie-publishable-key, Origin',
    'access-control-allow-origin': 'https://a.example',
    'x-ratelimit-remaining': '41',
    'x-galaxie-quota-remaining': '900',
    'x-galaxie-edge-ttl': '900',
    'surrogate-key': 'event',
  });

  it('a cópia leva o TTL da borda e o Cache-Tag, sem o que é de uma requisição só', () => {
    const h = storedHeaders(origin, 900, ['event', 'event:1']);
    expect(h.get('cache-control')).toBe('public, max-age=900');
    expect(h.get('cache-tag')).toBe('event,event:1');
    expect(h.get('vary')).toBeNull();
    expect(h.get('x-ratelimit-remaining')).toBeNull();
    expect(h.get('x-galaxie-quota-remaining')).toBeNull();
    expect(h.get('x-galaxie-edge-ttl')).toBeNull();
    expect(h.get('access-control-allow-origin')).toBe('https://a.example');
    expect(h.get('etag')).toBe('"abc"');
  });

  it('no HIT voltam o Cache-Control e o Vary da origem, sem as marcas internas', () => {
    const h = servedHeaders(storedHeaders(origin, 900, ['event']), 'HIT');
    expect(h.get('cache-control')).toBe('public, max-age=300, s-maxage=86400');
    expect(h.get('vary')).toBe(origin.get('vary'));
    expect(h.get('cache-tag')).toBeNull();
    expect(h.get('x-galaxie-origin-cache-control')).toBeNull();
    expect(h.get(EDGE_STATUS_HEADER)).toBe('HIT');
  });

  it('no MISS sai a marca da origem', () => {
    const h = servedHeaders(origin, 'MISS');
    expect(h.get('x-galaxie-edge-ttl')).toBeNull();
    expect(h.get('x-ratelimit-remaining')).toBe('41');
    expect(h.get(EDGE_STATUS_HEADER)).toBe('MISS');
  });

  it('ETag: lista, * e validador fraco', () => {
    expect(matchesEtag('W/"abc"', '"abc"')).toBe(true);
    expect(matchesEtag('"x", "abc"', '"abc"')).toBe(true);
    expect(matchesEtag('*', '"abc"')).toBe(true);
    expect(matchesEtag('"x"', '"abc"')).toBe(false);
    expect(matchesEtag('"abc"', null)).toBe(false);
  });
});

describe('originHeaders', () => {
  it('preserva IP e país do cliente até a origem', () => {
    const r = req('/v1/x', { 'cf-connecting-ip': '203.0.113.7', 'x-galaxie-key': KEY });
    const h = originHeaders(r, 'BR', false);
    expect(h.get('x-real-ip')).toBe('203.0.113.7');
    expect(h.get('cf-ipcountry')).toBe('BR');
    expect(h.get('x-galaxie-key')).toBe(KEY);
  });

  it('não troca o país que a Cloudflare já pôs', () => {
    const h = originHeaders(req('/v1/x', { 'cf-ipcountry': 'AR' }), 'BR', false);
    expect(h.get('cf-ipcountry')).toBe('AR');
  });

  it('tira os condicionais quando a resposta pode ir à borda', () => {
    const r = req('/v1/x', { 'if-none-match': '"abc"', 'if-modified-since': 'x' });
    expect(originHeaders(r, undefined, true).get('if-none-match')).toBeNull();
    expect(originHeaders(r, undefined, false).get('if-none-match')).toBe('"abc"');
  });
});
