/**
 * Proteção contra SSRF nas buscas de URLs que vêm de fora (modelo, página de terceiro, CDN):
 *
 * - filtro estático da URL: só http(s), sem usuário/senha, sem nome interno e sem IP literal privado;
 * - `guardedLookup`: na CONEXÃO, o DNS é resolvido por um `lookup` próprio que recusa o host se qualquer
 *   endereço for privado, de loopback, link-local (metadados da nuvem), CGNAT (100.64/10), reservado ou
 *   IPv4 mapeado/traduzido em IPv6 — o endereço conferido é o mesmo usado na conexão (sem janela para
 *   rebinding);
 * - `guardedFetch`: `fetch` com essa conexão, que repete as duas conferências a cada redirecionamento.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

/** Nomes internos (sem ponto também: resolvem pelo domínio de busca da máquina). */
const PRIVATE_NAME = /^(localhost|.*\.local|.*\.internal|.*\.localhost|.*\.home\.arpa|[^.]+)$/i;

/** Faixas que nunca são buscadas. IPv4 mapeado em IPv6 (::ffff:a.b.c.d) cai nas regras de IPv4. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "esta rede"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local (metadados da nuvem)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado e broadcast
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 96], // não especificado, loopback e IPv4 compatível
  ['64:ff9b::', 96], // NAT64 (IPv4 traduzido)
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4 (IPv4 embutido)
  ['fc00::', 7], // ULA (inclui os metadados fd00:ec2::254)
  ['fe80::', 10], // link-local
  ['fec0::', 10],
  ['ff00::', 8], // multicast
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** Endereço IP público (roteável na internet)? */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return false;
  return !BLOCKED.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/** Host da URL sem colchetes (IPv6) nem ponto final. */
export const bareHost = (u: URL): string => u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');

/** Nome de host que nunca é buscado (localhost, .local, .internal, nome sem ponto…). */
export const isPrivateName = (host: string): boolean => PRIVATE_NAME.test(host);

/**
 * URL pública http(s)? Filtro estático (nome e IP literal): o DNS é conferido na conexão
 * (`guardedLookup`) — um nome público pode resolver para IP interno.
 */
export function isPublicHttpUrl(url: string): boolean {
  return allowedUrl(url, isPublicAddress);
}

/** Filtro estático da URL; IP literal (que não passa pelo `lookup`) segue a política da conexão. */
function allowedUrl(url: string, allowAddress: (ip: string) => boolean): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    const host = bareHost(u);
    if (!host) return false;
    if (isIP(host)) return allowAddress(host);
    return !isPrivateName(host);
  } catch {
    return false;
  }
}

/** Resolve um nome em todos os endereços (injetável nos testes). */
export type HostResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const systemResolver: HostResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Código do erro de endereço recusado (na conexão ou no filtro da URL). */
export const NOT_PUBLIC = 'EADDRNOTPUBLIC';

const lookupError = (message: string, code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

/** Erro de endereço não público (filtro estático ou `lookup`)? */
export const isNotPublicError = (err: unknown): boolean => {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause)
    if ((e as NodeJS.ErrnoException).code === NOT_PUBLIC) return true;
  return false;
};

/**
 * `lookup` para net/tls: resolve o nome, recusa se QUALQUER endereço não for permitido e entrega à
 * conexão só os endereços conferidos.
 */
export function guardedLookup(
  resolve: HostResolver = systemResolver,
  allowed: (ip: string) => boolean = isPublicAddress,
): LookupFunction {
  return (hostname, options, callback) => {
    const fail = (err: NodeJS.ErrnoException) => callback(err, '', 0);
    resolve(hostname).then(
      (all) => {
        if (!all.length || all.some((a) => !allowed(a.address)))
          return fail(lookupError(`endereço não público: ${hostname}`, NOT_PUBLIC));
        const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
        const wanted = family === 4 || family === 6 ? all.filter((a) => a.family === family) : all;
        if (!wanted.length) return fail(lookupError(`sem endereço IPv${family}: ${hostname}`, 'ENOTFOUND'));
        if (options.all) callback(null, wanted);
        else callback(null, wanted[0]!.address, wanted[0]!.family);
      },
      (err: NodeJS.ErrnoException) => fail(err),
    );
  };
}

/**
 * O host pode ser buscado? Nome interno ou IP literal privado: não; nome: TODOS os endereços do DNS
 * precisam ser públicos. Para quem não controla a conexão (o navegador headless): a conferência é
 * feita antes e o DNS do navegador pode responder outra coisa depois; a rede isolada do navegador
 * cobre essa janela.
 */
export async function hostIsPublic(
  host: string,
  resolve: HostResolver = systemResolver,
  allowed: (ip: string) => boolean = isPublicAddress,
): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  if (isIP(h)) return allowed(h);
  if (isPrivateName(h)) return false;
  try {
    const all = await resolve(h);
    return all.length > 0 && all.every((a) => allowed(a.address));
  } catch {
    return false;
  }
}

export interface GuardedFetchOptions {
  /** Resolução de nomes (padrão: DNS do sistema). Testes injetam um resolvedor falso. */
  resolve?: HostResolver;
  /** Endereços aceitos na conexão (padrão: só públicos). Testes liberam o servidor local. */
  allowAddress?: (ip: string) => boolean;
  /** Redirecionamentos seguidos com `redirect: 'follow'` (padrão 5). */
  maxRedirects?: number;
}

export type GuardedFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const notAllowed = (url: string) =>
  Object.assign(new TypeError(`URL não permitida: ${url}`), { code: NOT_PUBLIC });

/** Corpo da requisição aceito (o necessário para GET/HEAD/POST simples). */
function requestBody(body: RequestInit['body']): string | Uint8Array | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string' || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError('guardedFetch: corpo não suportado (use string ou bytes)');
}

/**
 * `fetch` com o DNS conferido na conexão (`guardedLookup`, conexão própria, sem pool) e a URL conferida
 * antes de cada salto. `redirect: 'manual'` devolve o 3xx com o `Location`; `'follow'` (padrão) segue até
 * `maxRedirects`, conferindo cada destino; `'error'` falha no primeiro 3xx. Recusa = TypeError com
 * `code: 'EADDRNOTPUBLIC'` (como uma falha de rede do `fetch`). Descomprime gzip, deflate e br.
 */
export function guardedFetch(options: GuardedFetchOptions = {}): GuardedFetch {
  const allowAddress = options.allowAddress ?? isPublicAddress;
  const lookup = guardedLookup(options.resolve ?? systemResolver, allowAddress);
  const maxRedirects = options.maxRedirects ?? 5;

  const once = (url: URL, init: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const headers = new Headers(init.headers);
      if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br');
      const method = (init.method ?? 'GET').toUpperCase();
      const req = client.request(
        url,
        {
          method,
          headers: Object.fromEntries(headers),
          // conexão própria (nunca um socket do pool de outro cliente, aberto sem a conferência)
          agent: false,
          lookup,
          ...(init.signal ? { signal: init.signal } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            for (const item of Array.isArray(v) ? v : [v]) out.append(k, item);
          }
          const noBody = method === 'HEAD' || status === 204 || status === 304 || status < 200;
          let stream: Readable = res;
          const encoding = String(res.headers['content-encoding'] ?? '')
            .trim()
            .toLowerCase();
          if (!noBody) {
            if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
            else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
            else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
            if (stream !== res) {
              out.delete('content-encoding');
              out.delete('content-length');
              res.on('error', (err) => stream.destroy(err));
            }
          } else res.resume();
          const response = new Response(
            noBody ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>),
            { status: status || 500, statusText: res.statusMessage ?? '', headers: out },
          );
          Object.defineProperty(response, 'url', { value: url.toString() });
          resolve(response);
        },
      );
      req.on('error', (err) =>
        reject(
          Object.assign(new TypeError('fetch failed', { cause: err }), {
            ...((err as NodeJS.ErrnoException).code === NOT_PUBLIC ? { code: NOT_PUBLIC } : {}),
          }),
        ),
      );
      const body = requestBody(init.body);
      if (body !== undefined) req.end(body);
      else req.end();
    });

  return async (input, init = {}) => {
    let current = typeof input === 'string' ? input : input.toString();
    const mode = init.redirect ?? 'follow';
    for (let hop = 0; ; hop++) {
      if (!allowedUrl(current, allowAddress)) throw notAllowed(current);
      const res = await once(new URL(current), init);
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location || mode === 'manual') return res;
      await res.body?.cancel().catch(() => {});
      if (mode === 'error') throw new TypeError(`redirecionamento recusado: ${current}`);
      if (hop >= maxRedirects) throw new TypeError(`redirecionamentos demais: ${current}`);
      current = new URL(location, current).toString();
    }
  };
}
