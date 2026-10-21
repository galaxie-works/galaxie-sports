/**
 * URLs de mídia da api-sports (`media.api-sports.io`): logos, bandeiras, estádios, fotos.
 * Não consomem cota da API de dados, mas têm limite por segundo/minuto — por isso são espelhadas
 * no nosso object storage pelo Asset Mirror e a API reescreve as URLs para o nosso CDN (docs/03 §7).
 * Funções puras: sem rede e sem banco.
 */

/** Host da CDN de mídia e seus espelhos numerados (media-1, media-2...). */
const MEDIA_HOST = /^media(?:-\d+)?\.api-sports\.io$/i;

/** Encontra URLs de mídia em texto (JSON serializado, inclusive com barras escapadas `\/`). */
const MEDIA_URL_IN_TEXT = /https?:(?:\\?\/){2}media(?:-\d+)?\.api-sports\.io(?:\\?\/[A-Za-z0-9_\-.]+)+/gi;

/** Prefixo das chaves no bucket para o que veio da api-sports. */
export const MEDIA_STORAGE_PREFIX = 'api-sports';

export type MediaAssetKind =
  | 'flag'
  | 'league_logo'
  | 'team_logo'
  | 'venue'
  | 'player'
  | 'coach'
  | 'driver'
  | 'circuit'
  | 'fighter'
  | 'other';

export function isProviderMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && MEDIA_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Forma canônica de uma URL de mídia: https, host `media.api-sports.io` (os espelhos numerados servem o
 * mesmo arquivo), sem query string nem fragmento. Retorna `undefined` para URLs que não são da CDN.
 */
export function normalizeMediaUrl(url: string): string | undefined {
  if (!isProviderMediaUrl(url)) return undefined;
  const u = new URL(url);
  return `https://media.api-sports.io${u.pathname.replace(/\/{2,}/g, '/')}`;
}

/** Chave do objeto no bucket: `api-sports/<caminho original>` (ex.: `api-sports/football/teams/121.png`). */
export function mediaStorageKey(url: string): string | undefined {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return undefined;
  return `${MEDIA_STORAGE_PREFIX}${new URL(normalized).pathname}`;
}

/** Tipo do asset a partir do caminho (`/flags/br.svg`, `/football/teams/1.png`, `/formula-1/circuits/16.png`...). */
export function mediaKindFromUrl(url: string): MediaAssetKind {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return 'other';
  const parts = new URL(normalized).pathname.split('/').filter(Boolean);
  if (parts[0] === 'flags') return 'flag';
  switch (parts[1]) {
    case 'leagues':
      return 'league_logo';
    case 'teams':
      return 'team_logo';
    case 'venues':
      return 'venue';
    case 'players':
      return 'player';
    case 'coachs':
      return 'coach';
    case 'drivers':
      return 'driver';
    case 'circuits':
      return 'circuit';
    case 'fighters':
      return 'fighter';
    default:
      return 'other';
  }
}

/** Extrai e normaliza (sem repetição) todas as URLs de mídia presentes em um texto ou valor JSON. */
export function extractMediaUrls(input: unknown): string[] {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? null);
  const found = new Set<string>();
  for (const match of text.matchAll(MEDIA_URL_IN_TEXT)) {
    const normalized = normalizeMediaUrl(match[0].replace(/\\\//g, '/'));
    if (normalized) found.add(normalized);
  }
  return [...found].sort();
}

// ─── lista de bloqueio ───────────────────────────────────────────────────────────────────────────

export interface MediaDenylistEntry {
  url: string;
  reason: string;
}

/**
 * Assets que o fornecedor serve errados e que não podem aparecer no produto (ex.: o "logo" do Paulistão).
 * Comparação pela URL normalizada; o Asset Mirror não baixa (e desvincula, se já baixado) e a reescrita
 * devolve `null` para eles.
 */
export class MediaDenylist {
  private readonly entries = new Map<string, string>();

  constructor(entries: Iterable<MediaDenylistEntry> = []) {
    for (const e of entries) this.add(e);
  }

  add(entry: MediaDenylistEntry): void {
    const normalized = normalizeMediaUrl(entry.url);
    if (!normalized) throw new Error(`URL fora da CDN de mídia na lista de bloqueio: ${entry.url}`);
    this.entries.set(normalized, entry.reason);
  }

  has(url: string): boolean {
    const normalized = normalizeMediaUrl(url);
    return normalized !== undefined && this.entries.has(normalized);
  }

  reason(url: string): string | undefined {
    const normalized = normalizeMediaUrl(url);
    return normalized ? this.entries.get(normalized) : undefined;
  }

  get urls(): string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }
}

// ─── reescrita para o nosso CDN ──────────────────────────────────────────────────────────────────

export interface MediaRewriteOptions {
  /** Base pública do bucket/CDN (ASSETS_PUBLIC_BASE_URL), ex.: `http://localhost:9000/galaxie-sports-assets`. */
  publicBaseUrl: string;
  denylist?: MediaDenylist | undefined;
}

/**
 * URL pública de um objeto já gravado no bucket. Com o `sha256` do asset (core.asset), acrescenta `?v=<8 hex>`:
 * se o fornecedor trocar a imagem, a URL muda e o CDN pode cachear por muito tempo.
 */
export function publicAssetUrl(storageKey: string, publicBaseUrl: string, sha256?: string | null): string {
  const url = `${publicBaseUrl.replace(/\/+$/, '')}/${storageKey.replace(/^\/+/, '')}`;
  return sha256 ? `${url}?v=${sha256.slice(0, 8)}` : url;
}

/**
 * Reescreve uma URL de mídia do fornecedor para o nosso CDN. A chave é determinística (derivada do caminho),
 * então não precisa consultar o banco. URLs fora da CDN da api-sports (ex.: Wikimedia na NBA) voltam intactas;
 * URLs bloqueadas voltam `null` (melhor sem imagem do que com a imagem errada).
 */
export function rewriteMediaUrl(url: string, options: MediaRewriteOptions): string | null {
  if (options.denylist?.has(url)) return null;
  const key = mediaStorageKey(url);
  return key ? publicAssetUrl(key, options.publicBaseUrl) : url;
}

/** Aplica `rewriteMediaUrl` em todas as strings de um valor JSON (envelopes do espelho `/mirror/...`). */
export function rewriteMediaUrls<T>(value: T, options: MediaRewriteOptions): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return isProviderMediaUrl(v) ? rewriteMediaUrl(v, options) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
