/**
 * Filtros da página Ao vivo: status (ao vivo / próximos), esporte, país e competição. Puro (sem React):
 * lê e escreve a query string, filtra os eventos já buscados e monta as opções de cada filtro a partir
 * deles. A API de ao vivo aceita um esporte e uma competição só; aqui a escolha é múltipla, por isso o
 * filtro roda no navegador sobre o que a página já tem.
 */
import type { Event } from '@galaxie/contracts';

import {
  createFilterQuery,
  createFilterRule,
  flattenFilterRules,
} from '@/components/reui/filters/filters-query';
import type { FilterQuery } from '@/components/reui/filters/filters-types';

export type LiveStatus = 'live' | 'upcoming';
export const LIVE_STATUSES: readonly LiveStatus[] = ['live', 'upcoming'];

/** Escolhas de cada filtro; lista vazia = sem filtro (tudo). */
export interface LiveFilters {
  status: LiveStatus[];
  sport: string[];
  country: string[];
  competition: string[];
}

export type LiveFilterField = keyof LiveFilters;
export const LIVE_FILTER_FIELDS: readonly LiveFilterField[] = ['status', 'sport', 'country', 'competition'];

export const NO_LIVE_FILTERS: LiveFilters = { status: [], sport: [], country: [], competition: [] };

/** Nome de cada filtro na URL (`?esporte=football,basketball&pais=BR`), como os demais da demo. */
export const LIVE_FILTER_PARAMS: Record<LiveFilterField, string> = {
  status: 'status',
  sport: 'esporte',
  country: 'pais',
  competition: 'competicao',
};

/** Status na URL: `?status=ao-vivo` ou `?status=proximos`. */
const STATUS_PARAM: Record<LiveStatus, string> = { live: 'ao-vivo', upcoming: 'proximos' };

/** Operador único dos chips: "é um destes" (escolha múltipla). */
export const LIVE_FILTER_OPERATOR = 'is_any_of';

const splitList = (raw: string | null) => [
  ...new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

export function parseLiveFilters(params: Pick<URLSearchParams, 'get'>): LiveFilters {
  const status = splitList(params.get(LIVE_FILTER_PARAMS.status))
    .map((v) => LIVE_STATUSES.find((s) => STATUS_PARAM[s] === v))
    .filter((s): s is LiveStatus => !!s);
  return {
    status,
    sport: splitList(params.get(LIVE_FILTER_PARAMS.sport)),
    country: splitList(params.get(LIVE_FILTER_PARAMS.country)).map((c) => c.toUpperCase()),
    competition: splitList(params.get(LIVE_FILTER_PARAMS.competition)),
  };
}

/** A query string com os filtros, preservando os demais parâmetros da página. Sem `?` quando vazia. */
export function liveFiltersSearch(filters: LiveFilters, current: string | URLSearchParams = ''): string {
  const params = new URLSearchParams(current);
  for (const field of LIVE_FILTER_FIELDS) {
    const values =
      field === 'status' ? filters.status.map((s) => STATUS_PARAM[s]) : (filters[field] as string[]);
    if (values.length) params.set(LIVE_FILTER_PARAMS[field], values.join(','));
    else params.delete(LIVE_FILTER_PARAMS[field]);
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Os dois status escolhidos equivalem a nenhum: só conta quando sobra um. */
export function showsStatus(filters: LiveFilters, status: LiveStatus): boolean {
  return !filters.status.length || filters.status.includes(status);
}

export function hasLiveFilters(filters: LiveFilters): boolean {
  return LIVE_FILTER_FIELDS.some((f) => filters[f].length > 0);
}

/** País da competição (ISO2, ou `WORLD` nas internacionais); null sem país no catálogo. */
const countryOf = (e: Event) => e.competition?.country?.code ?? null;

/** Esporte, país e competição do evento batem com as escolhas (o status é decidido por lista). */
export function matchesLiveFilters(e: Event, filters: LiveFilters): boolean {
  if (filters.sport.length && !filters.sport.includes(e.sport)) return false;
  const country = countryOf(e);
  if (filters.country.length && !(country && filters.country.includes(country))) return false;
  const slug = e.competition?.slug;
  if (filters.competition.length && !(slug && filters.competition.includes(slug))) return false;
  return true;
}

export interface LiveFilterOption {
  value: string;
  label: string;
  /** Bandeira (país) ou escudo (competição), quando a API manda. */
  image: string | null;
  /** Quantos jogos (ao vivo e próximos) têm o valor. */
  count: number;
}

export interface LiveFilterOptions {
  sport: LiveFilterOption[];
  country: LiveFilterOption[];
  competition: LiveFilterOption[];
}

function collect(
  events: Event[],
  pick: (e: Event) => Omit<LiveFilterOption, 'count'> | null,
  selected: string[],
): LiveFilterOption[] {
  const out = new Map<string, LiveFilterOption>();
  for (const e of events) {
    const o = pick(e);
    if (!o) continue;
    const prev = out.get(o.value);
    out.set(o.value, prev ? { ...prev, count: prev.count + 1 } : { ...o, count: 1 });
  }
  // o que está na URL e não aparece nos jogos de agora continua escolhível (e removível)
  for (const value of selected)
    if (!out.has(value)) out.set(value, { value, label: value, image: null, count: 0 });
  return [...out.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Opções de cada filtro a partir dos jogos que a página tem (ao vivo e próximos). O país se restringe ao
 * esporte escolhido e a competição, ao esporte e ao país: escolher "Basquete" deixa só as ligas de basquete.
 */
export function liveFilterOptions(
  events: Event[],
  filters: LiveFilters,
  sportLabel: (slug: string) => string,
): LiveFilterOptions {
  const bySport = filters.sport.length ? events.filter((e) => filters.sport.includes(e.sport)) : events;
  const byCountry = filters.country.length
    ? bySport.filter((e) => {
        const c = countryOf(e);
        return !!c && filters.country.includes(c);
      })
    : bySport;
  return {
    sport: collect(
      events,
      (e) => ({ value: e.sport, label: sportLabel(e.sport), image: null }),
      filters.sport,
    ),
    country: collect(
      bySport,
      (e) => {
        const c = e.competition?.country;
        return c ? { value: c.code, label: c.name, image: c.flag } : null;
      },
      filters.country,
    ),
    competition: collect(
      byCountry,
      (e) => {
        const c = e.competition;
        return c ? { value: c.slug, label: c.name, image: c.logo } : null;
      },
      filters.competition,
    ),
  };
}

// ─── ponte com o componente de filtros (ReUI): um chip por filtro, sempre "é um destes" ───

export function toFilterQuery(filters: LiveFilters): FilterQuery {
  return createFilterQuery(
    LIVE_FILTER_FIELDS.filter((f) => filters[f].length).map((f) =>
      createFilterRule({ id: f, path: [f], operator: LIVE_FILTER_OPERATOR, value: [...filters[f]] }),
    ),
  );
}

/** Só os chips completos (com algum valor) viram filtro; o chip recém-criado, ainda vazio, não. */
export function fromFilterQuery(query: FilterQuery): LiveFilters {
  const out: LiveFilters = { status: [], sport: [], country: [], competition: [] };
  for (const rule of flattenFilterRules(query)) {
    const field = rule.path[0] as LiveFilterField | undefined;
    if (!field || !LIVE_FILTER_FIELDS.includes(field) || !Array.isArray(rule.value)) continue;
    const values = (rule.value as unknown[]).filter((v): v is string => typeof v === 'string');
    if (field === 'status')
      out.status = values.filter((v): v is LiveStatus => (LIVE_STATUSES as string[]).includes(v));
    else out[field] = values;
  }
  return out;
}
