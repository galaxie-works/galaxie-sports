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
import type { CompetitionContext } from './context.js';
import type { EventContext } from './event-context.js';
import type {
  Event,
  EventLineups,
  EventsQuery,
  EventStats,
  EventTimeline,
  HeadToHead,
  LiveEventsQuery,
  TeamSummary,
} from './events.js';
import type { MirrorEnvelope, MirrorSource, MirrorSport } from './mirror.js';
import type { Broadcaster, WhereToWatch } from './where-to-watch.js';
import type { RelatedContent, RelatedContentTypeName } from './related.js';
import type { SearchQuery, SearchResponse } from './search.js';
import type {
  Person,
  PersonOverview,
  Squad,
  Team,
  TeamEventsQuery,
  TeamOverview,
  TeamsQuery,
} from './teams.js';
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
import type {
  CountryCompetitions,
  CountryCompetitionsQuery,
  CountryDetail,
  Navigation,
} from './navigation.js';
import type { ExploreSummary } from './explore.js';

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
    /** Menu da navegação: 12 esportes e países com bandeira e confederação. */
    navigation: (opts: LocaleOpts = {}) => v1<Navigation>('/v1/navigation', opts),
    /** Resumo da home "Explorar": contadores por esporte e por país, destaques e o jogo de maior relevância. */
    exploreSummary: (opts: LocaleOpts = {}) => v1<ExploreSummary>('/v1/explore/summary', opts),
    country: (code: string, opts: LocaleOpts = {}) => v1<CountryDetail>(`/v1/countries/${seg(code)}`, opts),
    /** Competições do país por esporte e escopo (domésticas, continentais, seleções, mundiais). */
    countryCompetitions: (code: string, query: Omit<CountryCompetitionsQuery, 'locale'> & LocaleOpts = {}) =>
      v1<CountryCompetitions>(`/v1/countries/${seg(code)}/competitions`, query as Query & LocaleOpts),
    standings: (id: string, season: number | 'current', opts: LocaleOpts = {}) =>
      v1<Standings>(`/v1/competitions/${seg(id)}/seasons/${season}/standings`, opts),
    venue: (id: string, opts: LocaleOpts = {}) => v1<Venue>(`/v1/venues/${seg(id)}`, opts),
    /** Onde assistir um evento num país (`region` = UF/praça, opcional). */
    whereToWatch: (eventId: string, country: string, opts: LocaleOpts & { region?: string } = {}) =>
      v1<WhereToWatch>(`/v1/events/${seg(eventId)}/where-to-watch`, { country, ...opts } as Query &
        LocaleOpts),
    /** Biblioteca de emissoras (logo, canais por país); `country` filtra. */
    broadcasters: (opts: LocaleOpts & { country?: string } = {}) =>
      v1<{ data: Broadcaster[] }>('/v1/broadcasters', opts as Query & LocaleOpts),
    broadcaster: (id: string, opts: LocaleOpts = {}) => v1<Broadcaster>(`/v1/broadcasters/${seg(id)}`, opts),
    competitionContext: (id: string, opts: LocaleOpts & { season?: number | 'current' } = {}) =>
      v1<CompetitionContext>(`/v1/competitions/${seg(id)}/context`, opts),

    // ─── eventos ─────────────────────────────────────────────────────────────────────────────────
    events: (query: Omit<EventsQuery, 'locale' | 'status'> & LocaleOpts & { status?: string } = {}) =>
      v1<Page<Event>>('/v1/events', query as Query & LocaleOpts),
    liveEvents: (query: Omit<LiveEventsQuery, 'locale'> & LocaleOpts = {}) =>
      v1<{ data: Event[] }>('/v1/events/live', query as Query & LocaleOpts),
    /** Evento completo; `market` (ISO2) preenche a relevância por país. */
    event: (id: string, opts: LocaleOpts & { market?: string } = {}) =>
      v1<Event>(`/v1/events/${seg(id)}`, opts as Query & LocaleOpts),
    eventTimeline: (id: string, opts: LocaleOpts = {}) =>
      v1<EventTimeline>(`/v1/events/${seg(id)}/timeline`, opts),
    eventLineups: (id: string, opts: LocaleOpts = {}) =>
      v1<EventLineups>(`/v1/events/${seg(id)}/lineups`, opts),
    eventStats: (id: string, opts: LocaleOpts = {}) => v1<EventStats>(`/v1/events/${seg(id)}/stats`, opts),
    /** Cenário pré-jogo / resumo pós-jogo de IA (módulo live_intelligence). */
    eventContext: (id: string, opts: LocaleOpts & { kind?: 'scenario' | 'recap' } = {}) =>
      v1<EventContext>(`/v1/events/${seg(id)}/context`, opts),
    /** Vídeos relacionados ao evento, por tipo e formato (módulo related_content). */
    eventRelated: (
      id: string,
      opts: LocaleOpts & { type?: RelatedContentTypeName[]; format?: 'short' | 'long'; limit?: number } = {},
    ) =>
      v1<RelatedContent>(`/v1/events/${seg(id)}/related`, {
        ...opts,
        ...(opts.type ? { type: opts.type.join(',') } : {}),
      } as Query & LocaleOpts),
    eventH2h: (id: string, opts: LocaleOpts & { limit?: number } = {}) =>
      v1<HeadToHead>(`/v1/events/${seg(id)}/h2h`, opts),
    /** Arquivo .ics (RFC 5545) do evento, como texto. */
    eventIcs: async (id: string, opts: LocaleOpts = {}): Promise<string> =>
      (await request(`/v1/events/${seg(id)}.ics`, { locale: options.locale, ...opts })).text(),

    // ─── times e pessoas ─────────────────────────────────────────────────────────────────────────
    /** Busca global: times, competições, jogos, pessoas, estádios e países. */
    search: (query: Q<SearchQuery> & { q: string }) => v1<SearchResponse>('/v1/search', toQuery(query)),
    teams: (query: Omit<TeamsQuery, 'locale'> & LocaleOpts = {}) =>
      v1<Page<TeamSummary>>('/v1/teams', query as Query & LocaleOpts),
    team: (id: string, opts: LocaleOpts = {}) => v1<Team>(`/v1/teams/${seg(id)}`, opts),
    teamOverview: (id: string, opts: LocaleOpts & { season?: number } = {}) =>
      v1<TeamOverview>(`/v1/teams/${seg(id)}/overview`, opts),
    teamEvents: (
      id: string,
      query: Omit<TeamEventsQuery, 'locale' | 'status'> & LocaleOpts & { status?: string } = {},
    ) => v1<Page<Event>>(`/v1/teams/${seg(id)}/events`, query as Query & LocaleOpts),
    squad: (id: string, opts: LocaleOpts & { season?: number } = {}) =>
      v1<Squad>(`/v1/teams/${seg(id)}/squad`, opts),
    person: (id: string, opts: LocaleOpts = {}) => v1<Person>(`/v1/people/${seg(id)}`, opts),
    personOverview: (id: string, opts: LocaleOpts & { season?: number } = {}) =>
      v1<PersonOverview>(`/v1/people/${seg(id)}/overview`, opts),
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
