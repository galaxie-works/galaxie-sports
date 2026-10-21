/**
 * Busca de páginas de evidência (verificação e revalidação). Só http(s) públicos, com timeout,
 * limite de tamanho e User-Agent genérico — nunca e-mail ou dado pessoal na requisição.
 * Agregadores sem licença de reuso não chegam aqui (o chamador os pula).
 */
import { createHash } from 'node:crypto';

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

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|.*\.localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** URL pública http(s)? (bloqueia hosts internos — evita SSRF via URL sugerida pelo LLM). */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return !PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
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

export interface HttpPageFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}

export class HttpPageFetcher implements PageFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpPageFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async fetch(url: string): Promise<PageFetchResult> {
    let current = url;
    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      if (!isPublicHttpUrl(current))
        return { ok: false, status: 0, text: '', finalUrl: current, error: 'url_not_allowed' };
      let res: Response;
      try {
        res = await this.fetchImpl(current, {
          redirect: 'manual',
          headers: {
            'user-agent': WTW_USER_AGENT,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        return {
          ok: false,
          status: 0,
          text: '',
          finalUrl: current,
          error: err instanceof Error ? err.name : 'fetch_error',
        };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      if (!res.ok)
        return { ok: false, status: res.status, text: '', finalUrl: current, error: `http_${res.status}` };
      const body = await this.readLimited(res);
      return { ok: true, status: res.status, text: htmlToText(body), finalUrl: current };
    }
    return { ok: false, status: 0, text: '', finalUrl: current, error: 'too_many_redirects' };
  }

  private async readLimited(res: Response): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(value);
      if (total >= this.maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

/** Memoriza resultados por URL dentro de uma execução (cada página é buscada uma vez). */
export class CachingPageFetcher implements PageFetcher {
  private readonly cache = new Map<string, Promise<PageFetchResult>>();
  constructor(private readonly inner: PageFetcher) {}

  fetch(url: string): Promise<PageFetchResult> {
    let p = this.cache.get(url);
    if (!p) {
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
