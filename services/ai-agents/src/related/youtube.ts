/**
 * Cliente mínimo da YouTube Data API v3 (docs/12 §3): `search.list` (descoberta), `videos.list`
 * (duração, status, estatísticas) e `channels.list` (handle e inscritos). Conta as unidades de cota
 * de cada chamada. A chave vai só no parâmetro `key`; nenhum dado do usuário é enviado.
 */

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/** Custo de cota por método (unidades; tabela oficial da Data API v3). */
export const YOUTUBE_UNITS = { search: 100, videos: 1, channels: 1 } as const;

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export class YoutubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Motivo da API (`quotaExceeded`, `keyInvalid`...). */
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'YoutubeError';
  }

  get quotaExceeded(): boolean {
    return this.reason === 'quotaExceeded' || this.reason === 'dailyLimitExceeded';
  }
}

export interface SearchParams {
  q: string;
  publishedAfter: Date;
  publishedBefore?: Date;
  /** any (padrão) | short (< 4 min) | medium (4–20 min) | long (> 20 min). */
  videoDuration?: 'any' | 'short' | 'medium' | 'long';
  /** ISO 639-1 (pt, es). */
  relevanceLanguage?: string;
  /** ISO 3166-1 alpha-2. */
  regionCode?: string;
  order?: 'relevance' | 'date' | 'viewCount';
  maxResults?: number;
}

export interface SearchHit {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: string;
}

export interface VideoDetail {
  id: string;
  title: string;
  description: string;
  tags: string[];
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  defaultLanguage: string | null;
  privacyStatus: string | null;
  embeddable: boolean;
  uploadStatus: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Dimensões do player oficial (`player.embedWidth/embedHeight`): seguem a proporção real do vídeo. */
  frameWidth: number | null;
  frameHeight: number | null;
}

export interface ChannelDetail {
  id: string;
  title: string;
  /** `snippet.customUrl` (ex.: "@canal"), em minúsculas. */
  handle: string | null;
  subscribers: number | null;
  /** `snippet.country` (ISO 3166-1, quando o canal declara): localiza o vídeo por país. */
  country?: string | null;
}

/** Duração ISO 8601 (`PT1H2M3S`, `P0D`) → segundos; null se não reconhecida. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => (x ? Number(x) : 0));
  return d! * 86_400 + h! * 3600 + min! * 60 + s!;
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function bestThumbnail(thumbs: unknown): string | null {
  const t = obj(thumbs);
  for (const k of ['high', 'medium', 'standard', 'default', 'maxres']) {
    const url = str(obj(t[k]).url);
    if (url) return url;
  }
  return null;
}

export interface YoutubeClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Chamado a cada requisição com as unidades gastas (ledger de cota). */
  onUnits?: (units: number, method: keyof typeof YOUTUBE_UNITS) => void;
}

export class YoutubeClient {
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  /** Unidades gastas por este cliente. */
  units = 0;

  constructor(private readonly options: YoutubeClientOptions) {
    if (!options.apiKey) throw new Error('YOUTUBE_API_KEY não definida (veja .env.example).');
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl ?? YOUTUBE_API_BASE;
  }

  private async get(method: keyof typeof YOUTUBE_UNITS, params: Record<string, string>): Promise<Json> {
    const path = method === 'search' ? 'search' : method;
    const qs = new URLSearchParams({ ...params, key: this.options.apiKey });
    // a cota é cobrada mesmo quando a chamada falha
    this.units += YOUTUBE_UNITS[method];
    this.options.onUnits?.(YOUTUBE_UNITS[method], method);
    const res = await this.fetchFn(`${this.baseUrl}/${path}?${qs.toString()}`, {
      headers: { accept: 'application/json', 'user-agent': 'galaxie-sports/0.1' },
    });
    const body = obj(await res.json().catch(() => ({})));
    if (!res.ok) {
      const err = obj(body.error);
      const reason = str(obj((err.errors as unknown[] | undefined)?.[0]).reason);
      // a mensagem do Google explica a causa (API desligada, restrição de IP/referer, cota) e não traz a chave
      const detail = str(err.message)?.slice(0, 300);
      throw new YoutubeError(
        `YouTube ${path}: HTTP ${res.status}${reason ? ` (${reason})` : ''}${detail ? ` — ${detail}` : ''}`,
        res.status,
        reason,
      );
    }
    return body;
  }

  /** `search.list` (100 unidades): vídeos públicos e incorporáveis. */
  async search(p: SearchParams): Promise<SearchHit[]> {
    const params: Record<string, string> = {
      part: 'snippet',
      type: 'video',
      q: p.q,
      publishedAfter: p.publishedAfter.toISOString(),
      videoEmbeddable: 'true',
      order: p.order ?? 'relevance',
      maxResults: String(Math.min(50, Math.max(1, p.maxResults ?? 25))),
      safeSearch: 'moderate',
    };
    if (p.publishedBefore) params.publishedBefore = p.publishedBefore.toISOString();
    if (p.videoDuration && p.videoDuration !== 'any') params.videoDuration = p.videoDuration;
    if (p.relevanceLanguage) params.relevanceLanguage = p.relevanceLanguage;
    if (p.regionCode) params.regionCode = p.regionCode;
    const body = await this.get('search', params);
    const items = Array.isArray(body.items) ? body.items : [];
    return items.flatMap((raw) => {
      const it = obj(raw);
      const videoId = str(obj(it.id).videoId);
      const sn = obj(it.snippet);
      const channelId = str(sn.channelId);
      if (!videoId || !channelId) return [];
      return [{ videoId, channelId, title: str(sn.title) ?? '', publishedAt: str(sn.publishedAt) ?? '' }];
    });
  }

  /** `videos.list` (1 unidade por lote de 50). Ids ausentes na resposta = removidos/privados. */
  async videos(ids: readonly string[]): Promise<VideoDetail[]> {
    const out: VideoDetail[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.get('videos', {
        // `player` com maxWidth devolve embedWidth/embedHeight na proporção real do vídeo (sem custo extra)
        part: 'snippet,contentDetails,statistics,status,player',
        id: ids.slice(i, i + 50).join(','),
        maxResults: '50',
        maxWidth: '1280',
      });
      for (const raw of Array.isArray(body.items) ? body.items : []) {
        const it = obj(raw);
        const sn = obj(it.snippet);
        const cd = obj(it.contentDetails);
        const st = obj(it.statistics);
        const status = obj(it.status);
        const player = obj(it.player);
        const id = str(it.id);
        if (!id) continue;
        out.push({
          id,
          title: str(sn.title) ?? '',
          description: str(sn.description) ?? '',
          tags: Array.isArray(sn.tags) ? sn.tags.filter((t): t is string => typeof t === 'string') : [],
          channelId: str(sn.channelId) ?? '',
          channelTitle: str(sn.channelTitle) ?? '',
          publishedAt: str(sn.publishedAt) ?? '',
          durationSeconds: parseIsoDuration(str(cd.duration)),
          thumbnailUrl: bestThumbnail(sn.thumbnails),
          defaultLanguage: str(sn.defaultAudioLanguage) ?? str(sn.defaultLanguage),
          privacyStatus: str(status.privacyStatus),
          embeddable: status.embeddable !== false,
          uploadStatus: str(status.uploadStatus),
          views: num(st.viewCount),
          likes: num(st.likeCount),
          comments: num(st.commentCount),
          frameWidth: num(player.embedWidth),
          frameHeight: num(player.embedHeight),
        });
      }
    }
    return out;
  }

  /** `channels.list` (1 unidade por lote de 50): handle (`customUrl`) e inscritos. */
  async channels(ids: readonly string[]): Promise<ChannelDetail[]> {
    const out: ChannelDetail[] = [];
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 50) {
      const body = await this.get('channels', {
        part: 'snippet,statistics',
        id: unique.slice(i, i + 50).join(','),
        maxResults: '50',
      });
      for (const raw of Array.isArray(body.items) ? body.items : []) {
        const it = obj(raw);
        const sn = obj(it.snippet);
        const st = obj(it.statistics);
        const id = str(it.id);
        if (!id) continue;
        const handle = str(sn.customUrl);
        out.push({
          id,
          title: str(sn.title) ?? '',
          handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`).toLowerCase() : null,
          subscribers: st.hiddenSubscriberCount === true ? null : num(st.subscriberCount),
          country: str(sn.country)?.toUpperCase() ?? null,
        });
      }
    }
    return out;
  }
}

/** Dia da cota do YouTube (zera à meia-noite do Pacífico), YYYY-MM-DD. */
export function youtubeQuotaDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
