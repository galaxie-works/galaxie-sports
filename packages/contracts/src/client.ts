import type * as z from 'zod';
import type {
  Competition,
  CompetitionsQuery,
  CompetitionSummary,
  Country,
  Sport,
  Standings,
  Venue,
} from './catalog.js';
import type { Problem, SupportedLocale } from './common.js';
import type { MirrorEnvelope, MirrorSource, MirrorSport } from './mirror.js';

export interface GalaxieClientOptions {
  /** Ex.: http://localhost:8080 */
  baseUrl: string;
  apiKey: string;
  /** Locale padrão das chamadas /v1. */
  locale?: SupportedLocale;
  /** Fuso padrão (IANA). */
  tz?: string;
  /** fetch alternativo (testes, Next.js com cache). */
  fetch?: typeof fetch;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface MirrorResult {
  envelope: MirrorEnvelope;
  source: MirrorSource | null;
  fetchedAt: string | null;
}

/** Erro devolvido pela API (RFC 9457). */
export class GalaxieApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.title ?? `HTTP ${status}`);
    this.name = 'GalaxieApiError';
  }
}

type Query = Record<string, string | number | undefined>;
type LocaleOpts = { locale?: SupportedLocale; tz?: string };

/** Cliente tipado da API Galaxie Sports (usado pelo demo). Funciona em Node 24 e no browser. */
export function createGalaxieClient(options: GalaxieClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function request(path: string, query: Query = {}): Promise<Response> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const url = `${base}${path}${qs.size ? `?${qs}` : ''}`;
    const res = await doFetch(url, {
      headers: { 'x-galaxie-key': options.apiKey, accept: 'application/json' },
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as Problem | null;
      throw new GalaxieApiError(res.status, problem);
    }
    return res;
  }

  const v1 = async <T>(path: string, query: Query & LocaleOpts = {}): Promise<T> => {
    const res = await request(path, { locale: options.locale, tz: options.tz, ...query });
    return (await res.json()) as T;
  };

  const seg = (s: string) => encodeURIComponent(s);

  return {
    sports: (opts: LocaleOpts = {}) => v1<{ data: Sport[] }>('/v1/sports', opts),
    countries: (opts: LocaleOpts = {}) => v1<{ data: Country[] }>('/v1/countries', opts),
    competitions: (query: Omit<CompetitionsQuery, 'locale'> & LocaleOpts = {}) =>
      v1<Page<CompetitionSummary>>('/v1/competitions', query as Query & LocaleOpts),
    competition: (id: string, opts: LocaleOpts = {}) => v1<Competition>(`/v1/competitions/${seg(id)}`, opts),
    standings: (id: string, season: number | 'current', opts: LocaleOpts = {}) =>
      v1<Standings>(`/v1/competitions/${seg(id)}/seasons/${season}/standings`, opts),
    venue: (id: string, opts: LocaleOpts = {}) => v1<Venue>(`/v1/venues/${seg(id)}`, opts),
    /** Espelho compatível: mesmo endpoint e parâmetros da api-sports. */
    mirror: async (sport: MirrorSport, endpoint: string, params: Query = {}): Promise<MirrorResult> => {
      const res = await request(`/mirror/${sport}/${endpoint.replace(/^\//, '')}`, params);
      return {
        envelope: (await res.json()) as MirrorEnvelope,
        source: res.headers.get('x-galaxie-source') as MirrorSource | null,
        fetchedAt: res.headers.get('x-galaxie-fetched-at'),
      };
    },
  };
}

export type GalaxieClient = ReturnType<typeof createGalaxieClient>;

/** Tipo de saída de um schema Zod (atalho para o demo). */
export type Infer<T extends z.ZodType> = z.infer<T>;
