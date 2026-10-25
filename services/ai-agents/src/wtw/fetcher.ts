/**
 * Busca de páginas de evidência (verificação e revalidação). Só http(s) públicos, com timeout,
 * limite de tamanho e User-Agent genérico — nunca e-mail ou dado pessoal na requisição.
 * Agregadores sem licença de reuso não chegam aqui (o chamador os pula).
 *
 * SSRF (a URL vem do modelo): o host passa por um filtro de nome/IP e, na CONEXÃO, o DNS é resolvido
 * por um `lookup` próprio que recusa o host se qualquer endereço for privado, de loopback, link-local
 * (metadados da nuvem), CGNAT (100.64/10), reservado ou IPv4 mapeado/traduzido em IPv6 — o endereço
 * conferido é o mesmo usado na conexão (sem janela para rebinding) e cada redirecionamento repete tudo.
 */
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';

export const WTW_USER_AGENT = 'galaxie-sports/0.1 (+onde-assistir)';

export interface PageFetchResult {
  ok: boolean;
  status: number;
  /** Texto visível aproximado (HTML sem tags/scripts). */
  text: string;
  finalUrl: string;
  error?: string;
}

export interface PageFetcher {
  fetch(url: string): Promise<PageFetchResult>;
}

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
const bareHost = (u: URL) => u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');

/**
 * URL pública http(s)? Filtro estático (nome e IP literal): o DNS é conferido na conexão
 * (`guardedLookup`) — um nome público pode resolver para IP interno.
 */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    const host = bareHost(u);
    if (!host) return false;
    if (isIP(host)) return isPublicAddress(host);
    return !PRIVATE_NAME.test(host);
  } catch {
    return false;
  }
}

/** Resolve um nome em todos os endereços (injetável nos testes). */
export type HostResolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: HostResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Código do erro de endereço recusado na conexão (vira `url_not_allowed`). */
const NOT_PUBLIC = 'EADDRNOTPUBLIC';

const lookupError = (message: string, code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(message), { code });

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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML → texto (sem scripts/estilos), suficiente para conferir menções e trechos. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash do texto normalizado (revalidação por diff). */
export function contentHash(text: string): string {
  return createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

/**
 * Corpo → texto pelo charset da resposta (cabeçalho ou `<meta charset>` no começo do HTML); sem
 * charset ou com um desconhecido, UTF-8. Página em ISO-8859-1 lida como UTF-8 perde os acentos e o
 * trecho e os nomes deixam de casar.
 */
export function decodeBody(body: Buffer, contentType?: string | null): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  const start = body.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(start)?.[1];
  for (const label of [fromHeader, fromMeta]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // rótulo desconhecido: tenta o próximo
    }
  }
  return body.toString('utf8');
}

export interface HttpPageFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Resolução de nomes (padrão: DNS do sistema). Testes injetam um resolvedor falso. */
  resolve?: HostResolver;
  /** Endereços aceitos na conexão (padrão: só públicos). Testes liberam o servidor local. */
  allowAddress?: (ip: string) => boolean;
}

interface RawResponse {
  status: number;
  location: string | null;
  body: string;
}

export class HttpPageFetcher implements PageFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly allowAddress: (ip: string) => boolean;
  private readonly lookup: LookupFunction;

  constructor(options: HttpPageFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.allowAddress = options.allowAddress ?? isPublicAddress;
    this.lookup = guardedLookup(options.resolve ?? systemResolver, this.allowAddress);
  }

  async fetch(url: string): Promise<PageFetchResult> {
    let current = url;
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (!this.allowedUrl(current))
        return { ok: false, status: 0, text: '', finalUrl: current, error: 'url_not_allowed' };
      let res: RawResponse;
      try {
        res = await this.get(current);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        return {
          ok: false,
          status: 0,
          text: '',
          finalUrl: current,
          error: code === NOT_PUBLIC ? 'url_not_allowed' : err instanceof Error ? err.name : 'fetch_error',
        };
      }
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, current).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300)
        return { ok: false, status: res.status, text: '', finalUrl: current, error: `http_${res.status}` };
      return { ok: true, status: res.status, text: htmlToText(res.body), finalUrl: current };
    }
    return { ok: false, status: 0, text: '', finalUrl: current, error: 'too_many_redirects' };
  }

  /** Filtro estático da URL; IP literal (que não passa pelo `lookup`) segue a política da conexão. */
  private allowedUrl(url: string): boolean {
    try {
      const u = new URL(url);
      const host = bareHost(u);
      if (!isIP(host)) return isPublicHttpUrl(url);
      const web = u.protocol === 'http:' || u.protocol === 'https:';
      return web && !u.username && !u.password && this.allowAddress(host);
    } catch {
      return false;
    }
  }

  /** Um GET sem seguir redirecionamento, com o DNS conferido na conexão, timeout e limite de bytes. */
  private get(url: string): Promise<RawResponse> {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.request(
        u,
        {
          method: 'GET',
          headers: {
            'user-agent': WTW_USER_AGENT,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            'accept-encoding': 'gzip, br',
          },
          // conexão própria (nunca um socket do pool de outro cliente, aberto sem a conferência)
          agent: false,
          lookup: this.lookup,
          signal: AbortSignal.timeout(this.timeoutMs),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            res.resume();
            const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
            resolve({ status, location, body: '' });
            return;
          }
          const encoding = String(res.headers['content-encoding'] ?? '')
            .trim()
            .toLowerCase();
          let body: Readable = res;
          if (encoding === 'gzip' || encoding === 'x-gzip') body = res.pipe(zlib.createGunzip());
          else if (encoding === 'br') body = res.pipe(zlib.createBrotliDecompress());
          const chunks: Buffer[] = [];
          let total = 0;
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve({
              status,
              location: null,
              body: decodeBody(Buffer.concat(chunks), res.headers['content-type']),
            });
          };
          body.on('data', (chunk: Buffer) => {
            if (settled) return;
            const room = this.maxBytes - total;
            chunks.push(chunk.byteLength > room ? chunk.subarray(0, room) : chunk);
            total += Math.min(chunk.byteLength, room);
            if (total >= this.maxBytes) {
              done();
              req.destroy();
            }
          });
          body.on('end', done);
          body.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
        },
      );
      req.on('error', (err) => reject(err));
      req.end();
    });
  }
}

/**
 * Memoriza resultados por URL dentro de uma execução: a grade da rodada buscada para um jogo é
 * reaproveitada pelos demais jogos e mercados do grupo (cada página é buscada uma vez; o hash do
 * conteúdo sai do mesmo texto).
 */
export class CachingPageFetcher implements PageFetcher {
  private readonly cache = new Map<string, Promise<PageFetchResult>>();
  hits = 0;
  constructor(private readonly inner: PageFetcher) {}

  get size(): number {
    return this.cache.size;
  }

  fetch(url: string): Promise<PageFetchResult> {
    let p = this.cache.get(url);
    if (p) this.hits++;
    else {
      p = this.inner.fetch(url);
      this.cache.set(url, p);
    }
    return p;
  }
}

/** Fetcher falso para testes: mapa URL → HTML (ou status de erro). */
export class FakePageFetcher implements PageFetcher {
  readonly requested: string[] = [];
  constructor(private readonly pages: Record<string, string | number>) {}

  set(url: string, page: string | number): void {
    this.pages[url] = page;
  }

  async fetch(url: string): Promise<PageFetchResult> {
    this.requested.push(url);
    const page = this.pages[url];
    if (page === undefined) return { ok: false, status: 404, text: '', finalUrl: url, error: 'http_404' };
    if (typeof page === 'number')
      return { ok: false, status: page, text: '', finalUrl: url, error: `http_${page}` };
    return { ok: true, status: 200, text: htmlToText(page), finalUrl: url };
  }
}
