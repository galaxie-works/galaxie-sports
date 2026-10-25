/**
 * Cliente mínimo da YouTube Data API v3 (docs/12 §3): `playlistItems.list` (uploads dos canais
 * conhecidos), `search.list` (descoberta, só como complemento), `videos.list` (duração, status,
 * estatísticas) e `channels.list` (playlist de uploads, handle e inscritos). Conta a cota de cada chamada
 * no balde dela. A chave vai só no parâmetro `key`; nenhum dado do usuário é enviado.
 */

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export type YoutubeMethod = 'search' | 'videos' | 'channels' | 'playlistItems';

/**
 * Balde de cota de cada método. Desde 1º/6/2026 a Data API conta `search.list` (e `videos.insert`) num
 * balde próprio, em CONSULTAS por dia (padrão de 100 por projeto); os demais métodos dividem o balde de
 * UNIDADES (padrão de 10.000/dia). Fontes: developers.google.com/youtube/v3/determine_quota_cost e o
 * histórico de revisões da API.
 */
export type QuotaBucket = 'search' | 'api';
export const YOUTUBE_BUCKET: Readonly<Record<YoutubeMethod, QuotaBucket>> = {
  search: 'search',
  videos: 'api',
  channels: 'api',
  playlistItems: 'api',
};

/** Custo por chamada no balde do método: 1 consulta (search) ou 1 unidade por lote/página de 50. */
export const YOUTUBE_UNITS: Readonly<Record<YoutubeMethod, number>> = {
  search: 1,
  videos: 1,
  channels: 1,
  playlistItems: 1,
};

/** Gasto nos dois baldes. */
export interface QuotaUsage {
  /** Consultas `search.list`. */
  search: number;
  /** Unidades de `videos`, `channels` e `playlistItems`. */
  api: number;
}

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
  /** `contentDetails.regionRestriction`: países onde toca (null = todos) e onde não toca. */
  regionAllowed: string[] | null;
  regionBlocked: string[];
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
  /** Playlist de uploads (`contentDetails.relatedPlaylists.uploads`, "UU…"). */
  uploadsPlaylistId?: string | null;
}

/** Um upload de canal (`playlistItems.list`). */
export interface PlaylistVideo {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  /** Publicação do vídeo (`contentDetails.videoPublishedAt`; sem ela, a entrada na playlist). */
  publishedAt: string;
}

export interface PlaylistPage {
  items: PlaylistVideo[];
  nextPageToken: string | null;
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

function channelOf(raw: unknown): ChannelDetail | null {
  const it = obj(raw);
  const sn = obj(it.snippet);
  const st = obj(it.statistics);
  const id = str(it.id);
  if (!id) return null;
  const handle = str(sn.customUrl);
  return {
    id,
    title: str(sn.title) ?? '',
    handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`).toLowerCase() : null,
    subscribers: st.hiddenSubscriberCount === true ? null : num(st.subscriberCount),
    country: str(sn.country)?.toUpperCase() ?? null,
    uploadsPlaylistId: str(obj(obj(it.contentDetails).relatedPlaylists).uploads),
  };
}

export interface YoutubeClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Chamado a cada requisição com o custo e o balde (ledger de cota). */
  onUnits?: (units: number, method: YoutubeMethod, bucket: QuotaBucket) => void;
}

export class YoutubeClient {
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  /** Unidades do balde geral (videos, channels, playlistItems) gastas por este cliente. */
  units = 0;
  /** Consultas `search.list` (balde próprio) feitas por este cliente. */
  searchCalls = 0;

  constructor(private readonly options: YoutubeClientOptions) {
    if (!options.apiKey) throw new Error('YOUTUBE_API_KEY não definida (veja .env.example).');
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl ?? YOUTUBE_API_BASE;
  }

  /** Gasto nos dois baldes até agora. */
  get usage(): QuotaUsage {
    return { search: this.searchCalls, api: this.units };
  }

  private async get(method: YoutubeMethod, params: Record<string, string>): Promise<Json> {
    const qs = new URLSearchParams({ ...params, key: this.options.apiKey });
    // a cota é cobrada mesmo quando a chamada falha
    const bucket = YOUTUBE_BUCKET[method];
    if (bucket === 'search') this.searchCalls += YOUTUBE_UNITS[method];
    else this.units += YOUTUBE_UNITS[method];
    this.options.onUnits?.(YOUTUBE_UNITS[method], method, bucket);
    const res = await this.fetchFn(`${this.baseUrl}/${method}?${qs.toString()}`, {
      headers: { accept: 'application/json', 'user-agent': 'galaxie-sports/0.1' },
    });
    const body = obj(await res.json().catch(() => ({})));
    if (!res.ok) {
      const err = obj(body.error);
      const reason = str(obj((err.errors as unknown[] | undefined)?.[0]).reason);
      // a mensagem do Google explica a causa (API desligada, restrição de IP/referer, cota) e não traz a chave
      const detail = str(err.message)?.slice(0, 300);
      throw new YoutubeError(
        `YouTube ${method}: HTTP ${res.status}${reason ? ` (${reason})` : ''}${detail ? ` — ${detail}` : ''}`,
        res.status,
        reason,
      );
    }
    return body;
  }

  /** `search.list` (1 consulta do balde de busca, ~100/dia): vídeos públicos e incorporáveis. */
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
          ...regionRestriction(cd.regionRestriction),
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

  /**
   * `channels.list` (1 unidade por lote de 50): handle (`customUrl`), inscritos e a playlist de uploads
   * (`contentDetails.relatedPlaylists.uploads`, na mesma chamada).
   */
  async channels(ids: readonly string[]): Promise<ChannelDetail[]> {
    const out: ChannelDetail[] = [];
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 50) {
      const body = await this.get('channels', {
        part: 'snippet,statistics,contentDetails',
        id: unique.slice(i, i + 50).join(','),
        maxResults: '50',
      });
      for (const raw of Array.isArray(body.items) ? body.items : []) {
        const ch = channelOf(raw);
        if (ch) out.push(ch);
      }
    }
    return out;
  }

  /** `channels.list?forHandle=` (1 unidade): o canal de um handle (`@palmeiras`), ou null. */
  async channelByHandle(handle: string): Promise<ChannelDetail | null> {
    const h = `@${handle.trim().replace(/^@/, '')}`;
    const body = await this.get('channels', { part: 'snippet,statistics,contentDetails', forHandle: h });
    const first = Array.isArray(body.items) ? body.items[0] : undefined;
    return first ? channelOf(first) : null;
  }

  /**
   * `playlistItems.list` (1 unidade por página de até 50): os uploads de um canal, do mais novo para o
   * mais antigo. É o caminho barato para os canais conhecidos (clube, liga, emissora).
   */
  async playlistItems(playlistId: string, pageToken?: string | null): Promise<PlaylistPage> {
    const params: Record<string, string> = {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50',
    };
    if (pageToken) params.pageToken = pageToken;
    const body = await this.get('playlistItems', params);
    const items = (Array.isArray(body.items) ? body.items : []).flatMap((raw) => {
      const it = obj(raw);
      const sn = obj(it.snippet);
      const cd = obj(it.contentDetails);
      const videoId = str(cd.videoId) ?? str(obj(sn.resourceId).videoId);
      if (!videoId) return [];
      return [
        {
          videoId,
          channelId: str(sn.videoOwnerChannelId) ?? str(sn.channelId) ?? '',
          title: str(sn.title) ?? '',
          description: str(sn.description) ?? '',
          publishedAt: str(cd.videoPublishedAt) ?? str(sn.publishedAt) ?? '',
        },
      ];
    });
    return { items, nextPageToken: str(body.nextPageToken) };
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

/** Fim do dia de cota de `at`: a próxima meia-noite do Pacífico (07:00 ou 08:00 UTC, conforme o horário de verão). */
export function youtubeQuotaDayEnd(at: Date): Date {
  const day = youtubeQuotaDay(at);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  for (const utcHour of [7, 8]) {
    const end = new Date(Date.UTC(y, m - 1, d + 1, utcHour));
    if (youtubeQuotaDay(end) !== day && youtubeQuotaDay(new Date(end.getTime() - 1)) === day) return end;
  }
  return new Date(Date.UTC(y, m - 1, d + 1, 8));
}

/** Países do `regionRestriction` (ISO 3166-1 em maiúsculas); sem restrição, toca em todos. */
export function regionRestriction(raw: unknown): { regionAllowed: string[] | null; regionBlocked: string[] } {
  const r = obj(raw);
  const codes = (v: unknown) =>
    Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string').map((c) => c.toUpperCase()) : null;
  return { regionAllowed: codes(r.allowed), regionBlocked: codes(r.blocked) ?? [] };
}
