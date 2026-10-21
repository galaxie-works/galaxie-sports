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
import type {
  Delegation,
  GamesDetail,
  GamesListQuery,
  GamesSummary,
  MedalHistory,
  MedalHistoryQuery,
  MedalsQuery,
  MedalTable,
  MsEventDetail,
  NocToday,
  ScheduleQuery,
  ScheduleUnit,
} from './multisport.js';
import type {
  CopyQuery,
  CopySuggestion,
  DerbiesQuery,
  Derby,
  DerbySummary,
  Glossary,
  GlossaryQuery,
  ReviewQuery,
  TeamRivals,
  TeamSemantic,
  UpcomingDerbiesQuery,
  UpcomingDerby,
} from './semantic.js';

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

type Query = Record<string, string | number | boolean | undefined>;
type LocaleOpts = { locale?: SupportedLocale; tz?: string };
/** Filtros de query sem o locale (o cliente injeta o padrão) e com listas como string ou array. */
type Q<T> = { [K in keyof Omit<T, 'locale' | 'tz'>]?: unknown } & LocaleOpts;
const toQuery = (q: object): Query =>
  Object.fromEntries(
    Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v as Query[string])]),
  );

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
    // ─── semântica (docs/06 §5) ───
    derbies: (query: Q<DerbiesQuery> = {}) => v1<{ data: DerbySummary[] }>('/v1/derbies', toQuery(query)),
    upcomingDerbies: (query: Q<UpcomingDerbiesQuery> = {}) =>
      v1<{ data: UpcomingDerby[] }>('/v1/derbies/upcoming', toQuery(query)),
    derby: (slug: string, query: Q<ReviewQuery> = {}) =>
      v1<Derby>(`/v1/derbies/${seg(slug)}`, toQuery(query)),
    teamSemantic: (id: string, query: Q<ReviewQuery> = {}) =>
      v1<TeamSemantic>(`/v1/teams/${seg(id)}/semantic`, toQuery(query)),
    teamRivals: (id: string, query: Q<ReviewQuery> = {}) =>
      v1<TeamRivals>(`/v1/teams/${seg(id)}/rivals`, toQuery(query)),
    glossary: (query: Q<GlossaryQuery> = {}) => v1<Glossary>('/v1/glossary', toQuery(query)),
    copy: (query: Q<CopyQuery> & { intent: string }) => v1<CopySuggestion>('/v1/copy', toQuery(query)),
    // ─── multiesporte (docs/08 §4) ───
    games: (query: Q<GamesListQuery> = {}) =>
      v1<{ data: GamesSummary[] }>('/v1/multisport/games', toQuery(query)),
    gamesEdition: (slug: string, opts: LocaleOpts = {}) =>
      v1<GamesDetail>(`/v1/multisport/games/${seg(slug)}`, opts),
    medals: (slug: string, query: Q<MedalsQuery> = {}) =>
      v1<MedalTable>(`/v1/multisport/games/${seg(slug)}/medals`, toQuery(query)),
    schedule: (slug: string, query: Q<ScheduleQuery> = {}) =>
      v1<Page<ScheduleUnit>>(`/v1/multisport/games/${seg(slug)}/schedule`, toQuery(query)),
    gamesEvent: (slug: string, id: string, opts: LocaleOpts = {}) =>
      v1<MsEventDetail>(`/v1/multisport/games/${seg(slug)}/events/${seg(id)}`, opts),
    delegation: (slug: string, noc: string, opts: LocaleOpts = {}) =>
      v1<Delegation>(`/v1/multisport/games/${seg(slug)}/nocs/${seg(noc)}/athletes`, opts),
    nocToday: (slug: string, noc: string, query: LocaleOpts & { date?: string } = {}) =>
      v1<NocToday>(`/v1/multisport/games/${seg(slug)}/today/${seg(noc)}`, query),
    medalHistory: (query: Q<MedalHistoryQuery> & { noc: string | string[] }) =>
      v1<MedalHistory>('/v1/multisport/history/medals', toQuery(query)),
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
