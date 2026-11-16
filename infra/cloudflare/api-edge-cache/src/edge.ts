/**
 * Regras puras do Worker de cache de borda da API (#1257): o que passa direto, a chave de cache, o que a origem
 * deixou guardar e por quanto tempo, e os headers da cópia guardada e da resposta ao cliente. O handler (index.ts)
 * só junta estas peças à Cache API.
 *
 * A Cloudflare ignora o `Vary` (fora o Accept-Encoding) e guarda uma cópia por URL. A resposta da API depende da
 * chave (plano, módulos, operadora), do idioma e da origem da página (CORS e chave publicável). Por isso a chave de
 * cache daqui junta a URL normalizada, o SHA-256 da chave da API, o locale que a API de fato usaria e a origem.
 */

/** Marca da origem (apps/api/src/cache/edge.ts): TTL da cópia na borda, em segundos. */
export const EDGE_TTL_HEADER = 'x-galaxie-edge-ttl';
/** Teto da cópia, o mesmo da origem: uma chave revogada para de receber cópias em no máximo 15 min. */
export const EDGE_MAX_TTL_SEC = 15 * 60;
/** Resultado do Worker na resposta ao cliente: HIT, MISS ou BYPASS. */
export const EDGE_STATUS_HEADER = 'x-galaxie-edge-cache';
/** Headers da cópia guardada que guardam o original (a Cache API lê `Cache-Control` e considera o `Vary`). */
export const ORIGIN_CACHE_CONTROL_HEADER = 'x-galaxie-origin-cache-control';
export const ORIGIN_VARY_HEADER = 'x-galaxie-origin-vary';

export const SECRET_KEY_HEADER = 'x-galaxie-key';
export const PUBLISHABLE_KEY_HEADER = 'x-galaxie-publishable-key';

/** Locales da API (packages/contracts/src/common.ts; o teste confere a cópia). */
export const SUPPORTED_LOCALES = [
  'pt-BR',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
  'en',
] as const;
export const DEFAULT_LOCALE = 'pt-BR';

/** Headers que valem só para a requisição que os recebeu: não vão para a cópia guardada. */
const PER_REQUEST_HEADERS = [
  'set-cookie',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-galaxie-quota-limit',
  'x-galaxie-quota-remaining',
  'x-galaxie-quota-warning',
];

/** Limite do `Cache-Tag` na Cloudflare: 16 KB somando as vírgulas. */
const CACHE_TAG_MAX = 16 * 1024 - 1;
const TAG_MAX_LENGTH = 1024;

const SUPPORTED = new Map(SUPPORTED_LOCALES.map((l) => [l.toLowerCase(), l as string]));

/** Accept-Language → tags por preferência (q), como `parseAcceptLanguage` da API. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag: (tag ?? '').trim(), q: q ? Number(q) : 1, i };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

/**
 * Locale que a API usaria (`resolveLocale` de apps/api/src/i18n.ts): `?locale=` válido primeiro; depois o
 * Accept-Language, pela tag exata (es-AR) ou pelo idioma (es → primeiro es-*, en-US → en); padrão pt-BR. Reduz o
 * Accept-Language aos 9 valores que mudam a resposta: `es-AR,es;q=0.9` e `es-AR` caem na mesma cópia.
 */
export function resolveLocale(queryLocale: string | null, acceptLanguage: string | null): string {
  if (queryLocale && SUPPORTED_LOCALES.includes(queryLocale as (typeof SUPPORTED_LOCALES)[number]))
    return queryLocale;
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const exact = SUPPORTED.get(tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.split('-')[0]!.toLowerCase();
    const same = SUPPORTED.get(lang) ?? SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${lang}-`));
    if (same) return same;
  }
  return DEFAULT_LOCALE;
}

/** Chave da API da requisição, com a mesma precedência da origem: a secreta vence a publicável. */
export function apiKeyOf(headers: Headers): { kind: 'secret' | 'publishable'; key: string } | undefined {
  const secret = headers.get(SECRET_KEY_HEADER)?.trim();
  if (secret) return { kind: 'secret', key: secret };
  const publishable = headers.get(PUBLISHABLE_KEY_HEADER)?.trim();
  if (publishable) return { kind: 'publishable', key: publishable };
  return undefined;
}

/**
 * Por que a requisição passa direto para a origem, sem olhar nem gravar a borda (ou `undefined` para usar a borda):
 * método que não é GET, fora de `/v1/`, SSE, token do torcedor (`Authorization`), chave na query (`?key=`, `?token=`
 * do SSE) e, principalmente, sem chave da API: sem chave nunca se guarda nem se serve cópia.
 */
export function bypassReason(request: Request): string | undefined {
  if (request.method !== 'GET') return 'method';
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/')) return 'path';
  if (/(^|\/)stream(\/|$)/.test(url.pathname)) return 'stream';
  if (request.headers.has('authorization')) return 'authorization';
  if (url.searchParams.has('key') || url.searchParams.has('token')) return 'query-key';
  if (!apiKeyOf(request.headers)) return 'no-key';
  return undefined;
}

/** Query em ordem de nome (a ordem não muda a resposta da API; valores repetidos mantêm a ordem entre si). */
export function sortedQuery(url: URL): string {
  const params = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const q = new URLSearchParams(params).toString();
  return q ? `?${q}` : '';
}

/**
 * Origem da página, como a API a lê: `Origin` ou, na falta dele, a origem do `Referer`. Entra na chave porque o
 * `Access-Control-Allow-Origin` guardado é o da página que pediu, e a chave publicável só vale nas origens dela.
 */
export function pageOrigin(headers: Headers): string {
  const origin = headers.get('origin');
  if (origin) return origin;
  const referer = headers.get('referer');
  if (!referer) return '';
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * URL da chave de cache: o mesmo host, um prefixo que a API não usa, o tipo e o SHA-256 da chave da API (a chave
 * nunca fica em claro na borda), o locale, o hash da origem da página, o caminho e a query em ordem.
 */
export async function cacheKeyUrl(request: Request): Promise<string> {
  const url = new URL(request.url);
  const apiKey = apiKeyOf(request.headers);
  if (!apiKey) throw new Error('requisição sem chave da API não tem chave de cache');
  const locale = resolveLocale(url.searchParams.get('locale'), request.headers.get('accept-language'));
  const keyHash = await sha256Hex(`${apiKey.kind}:${apiKey.key}`);
  const originHash = (await sha256Hex(pageOrigin(request.headers))).slice(0, 32);
  const kind = apiKey.kind === 'secret' ? 's' : 'p';
  return `https://${url.hostname.toLowerCase()}/__edge-cache/${kind}-${keyHash}/${locale}/${originHash}${url.pathname}${sortedQuery(url)}`;
}

/**
 * TTL da cópia que a origem autorizou (s), ou `undefined` para não guardar: só 200 com a marca da origem, número
 * inteiro ≥ 1 (aplicado o teto), sem `Set-Cookie`, sem `no-store`/`private`/`no-cache` e sem `Vary: *`. A regra de
 * quem recebe a marca mora na origem; aqui só se confere de novo o que tornaria a cópia perigosa.
 */
export function edgeTtlOf(response: Response): number | undefined {
  if (response.status !== 200) return undefined;
  const raw = response.headers.get(EDGE_TTL_HEADER);
  if (!raw) return undefined;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl < 1) return undefined;
  if (response.headers.has('set-cookie')) return undefined;
  const cc = (response.headers.get('cache-control') ?? '').toLowerCase();
  const directives = cc.split(',').map((d) => d.trim().split('=')[0]);
  if (directives.some((d) => d === 'no-store' || d === 'private' || d === 'no-cache')) return undefined;
  if ((response.headers.get('vary') ?? '').split(',').some((v) => v.trim() === '*')) return undefined;
  return Math.min(ttl, EDGE_MAX_TTL_SEC);
}

/** Tag aceita pela Cloudflare: ASCII imprimível, sem espaço e sem vírgula, até 1.024 caracteres. */
export function isCdnTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= TAG_MAX_LENGTH && /^[\x21-\x2b\x2d-\x7e]+$/.test(tag);
}

/**
 * Tags da resposta para o `Cache-Tag` da cópia: do `Cache-Tag` da origem, quando ele chega ao Worker (a
 * documentação diz que a Cloudflare o tira antes), ou do `surrogate-key` (separado por espaço). Sem tags, o Worker
 * não guarda: o purge por tag não alcançaria a cópia.
 */
export function tagsOf(headers: Headers): string[] {
  const raw = headers.get('cache-tag') ?? (headers.get('surrogate-key') ?? '').replace(/\s+/g, ',');
  const tags: string[] = [];
  let size = 0;
  for (const tag of new Set(raw.split(',').map((t) => t.trim()))) {
    if (!isCdnTag(tag)) continue;
    const add = tag.length + (tags.length ? 1 : 0);
    if (size + add > CACHE_TAG_MAX) break;
    tags.push(tag);
    size += add;
  }
  return tags;
}

/**
 * Headers da cópia guardada: sem os de uma requisição só (limite, cota, cookie), com o `Cache-Control` da borda
 * (o que a Cache API lê para o TTL), o `Cache-Tag` do purge e, à parte, o `Cache-Control` e o `Vary` originais,
 * que voltam no HIT. O `Vary` sai da cópia porque a Cache API o consideraria no `match` da chave sintética.
 */
export function storedHeaders(origin: Headers, ttl: number, tags: string[]): Headers {
  const h = new Headers(origin);
  for (const name of PER_REQUEST_HEADERS) h.delete(name);
  h.delete(EDGE_TTL_HEADER);
  h.delete(EDGE_STATUS_HEADER);
  const cc = origin.get('cache-control');
  if (cc) h.set(ORIGIN_CACHE_CONTROL_HEADER, cc);
  const vary = origin.get('vary');
  if (vary) h.set(ORIGIN_VARY_HEADER, vary);
  h.delete('vary');
  h.set('cache-control', `public, max-age=${ttl}`);
  h.set('cache-tag', tags.join(','));
  return h;
}

/** Headers da resposta ao cliente: os originais (no HIT, restaurados da cópia), sem as marcas internas. */
export function servedHeaders(source: Headers, status: 'HIT' | 'MISS'): Headers {
  const h = new Headers(source);
  if (status === 'HIT') {
    const cc = h.get(ORIGIN_CACHE_CONTROL_HEADER);
    if (cc) h.set('cache-control', cc);
    const vary = h.get(ORIGIN_VARY_HEADER);
    if (vary) h.set('vary', vary);
  }
  for (const name of [ORIGIN_CACHE_CONTROL_HEADER, ORIGIN_VARY_HEADER, EDGE_TTL_HEADER, 'cache-tag'])
    h.delete(name);
  h.set(EDGE_STATUS_HEADER, status);
  return h;
}

/** If-None-Match casa com o ETag (lista, `*` e validador fraco), como `matchesEtag` da API. */
export function matchesEtag(header: string | null, etag: string | null): boolean {
  if (!header || !etag) return false;
  const strong = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === strong);
}

/**
 * Cabeçalhos da requisição que segue para a origem: o IP e o país do cliente ficam explícitos (`x-real-ip`, que a
 * Cloudflare usa para o `CF-Connecting-IP` da sub-requisição da mesma zona, e `CF-IPCountry`, que o Shopping lê) e,
 * quando a resposta pode ir para a borda, sem os condicionais: a origem devolve o 200 inteiro, que se guarda, e o
 * 304 ao cliente sai daqui.
 */
export function originHeaders(
  request: Request,
  country: string | undefined,
  stripConditional: boolean,
): Headers {
  const h = new Headers(request.headers);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) h.set('x-real-ip', ip);
  if (country && !h.has('cf-ipcountry')) h.set('cf-ipcountry', country);
  if (stripConditional) {
    h.delete('if-none-match');
    h.delete('if-modified-since');
  }
  return h;
}
