/**
 * Filtros da página Ao vivo: status (ao vivo / próximos / encerrados), a janela dos encerrados, esporte, país
 * e competição. Puro (sem React):
 * lê e escreve a query string, filtra os eventos já buscados e monta as opções de cada filtro a partir
 * deles. A API aceita um esporte, um país e uma competição por chamada; aqui a escolha é múltipla, por isso
 * o ao vivo é filtrado no navegador e os próximos são buscados em recortes (`upcomingScopes`) e filtrados
 * de novo aqui.
 */
import type { Event } from '@galaxie/contracts';

import {
  createFilterQuery,
  createFilterRule,
  flattenFilterRules,
} from '@/components/reui/filters/filters-query';
import type { FilterQuery } from '@/components/reui/filters/filters-types';
import type { UpcomingScope } from '@/lib/galaxie/live';

export type LiveStatus = 'live' | 'upcoming' | 'finished';
export const LIVE_STATUSES: readonly LiveStatus[] = ['live', 'upcoming', 'finished'];

/** Janelas dos encerrados, em horas (apito inicial dentro da janela e jogo já terminado). */
export const FINISHED_WINDOWS = [6, 12, 24, 48, 72] as const;
export const DEFAULT_FINISHED_WINDOW = 12;

/** Escolhas de cada filtro; lista vazia = sem filtro (tudo). */
export interface LiveFilters {
  status: LiveStatus[];
  /** Janela dos encerrados (no máximo um valor, em horas); vazia = a padrão. Só existe com "Encerrados". */
  window: string[];
  sport: string[];
  country: string[];
  competition: string[];
}

export type LiveFilterField = keyof LiveFilters;
export const LIVE_FILTER_FIELDS: readonly LiveFilterField[] = [
  'status',
  'window',
  'sport',
  'country',
  'competition',
];

export const NO_LIVE_FILTERS: LiveFilters = {
  status: [],
  window: [],
  sport: [],
  country: [],
  competition: [],
};

/** Nome de cada filtro na URL (`?esporte=football,basketball&pais=BR`), como os demais da demo. */
export const LIVE_FILTER_PARAMS: Record<LiveFilterField, string> = {
  status: 'status',
  window: 'janela',
  sport: 'esporte',
  country: 'pais',
  competition: 'competicao',
};

/** Status na URL: `?status=ao-vivo`, `?status=proximos` ou `?status=encerrados` (com `&janela=24`). */
const STATUS_PARAM: Record<LiveStatus, string> = {
  live: 'ao-vivo',
  upcoming: 'proximos',
  finished: 'encerrados',
};

/** Operador dos chips: "é um destes" (escolha múltipla). */
export const LIVE_FILTER_OPERATOR = 'is_any_of';
/** Operador do chip da janela: escolha única ("últimas 12 horas"). */
export const WINDOW_FILTER_OPERATOR = 'is';

const isWindow = (v: string) => (FINISHED_WINDOWS as readonly number[]).includes(Number(v));

/**
 * A janela só vale com "Encerrados" escolhido e a padrão não é guardada: assim `?status=encerrados` e
 * `?status=encerrados&janela=12` são o mesmo filtro.
 */
function normalizeWindow(status: LiveStatus[], window: string[]): string[] {
  const value = window.filter(isWindow).at(-1);
  if (!status.includes('finished') || !value || Number(value) === DEFAULT_FINISHED_WINDOW) return [];
  return [String(Number(value))];
}

/** Horas da janela dos encerrados (a padrão quando nenhuma foi escolhida). */
export function finishedWindowHours(filters: LiveFilters): number {
  const value = Number(filters.window[0]);
  return isWindow(String(value)) ? value : DEFAULT_FINISHED_WINDOW;
}

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
    window: normalizeWindow(status, splitList(params.get(LIVE_FILTER_PARAMS.window))),
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

/**
 * Sem status escolhido, a página mostra ao vivo e próximos; os encerrados só aparecem quando escolhidos.
 */
export function showsStatus(filters: LiveFilters, status: LiveStatus): boolean {
  if (status === 'finished') return filters.status.includes('finished');
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
  /** Quantos jogos (ao vivo, próximos e encerrados) têm o valor. */
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
  /** Esportes com jogo nos próximos dias (facetas da agenda): entram mesmo sem jogo carregado. */
  upcomingSports: { slug: string; count: number }[] = [],
): LiveFilterOptions {
  const bySport = filters.sport.length ? events.filter((e) => filters.sport.includes(e.sport)) : events;
  const byCountry = filters.country.length
    ? bySport.filter((e) => {
        const c = countryOf(e);
        return !!c && filters.country.includes(c);
      })
    : bySport;
  const sport = new Map(
    collect(events, (e) => ({ value: e.sport, label: sportLabel(e.sport), image: null }), filters.sport).map(
      (o) => [o.value, o],
    ),
  );
  // a contagem da agenda (a semana toda) vale mais que a amostra carregada
  for (const s of upcomingSports) {
    const prev = sport.get(s.slug);
    sport.set(s.slug, {
      value: s.slug,
      label: sportLabel(s.slug),
      image: null,
      count: Math.max(prev?.count ?? 0, s.count),
    });
  }
  return {
    sport: [...sport.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
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

// ─── próximos apitos: buscas por esporte (ou já filtradas) e agrupamento ───

/** Jogos pedidos por busca de próximos (um esporte, um esporte num país ou uma competição). */
export const UPCOMING_FETCH_LIMIT = 12;
/** Teto de buscas filtradas de uma vez (esportes × países, ou competições). */
export const MAX_TARGETED_SCOPES = 24;

/**
 * Quais buscas de próximos a página faz. A `base` é sempre uma por esporte com jogo nos próximos dias:
 * os 100 jogos mais próximos eram só futebol, e assim cada esporte traz os seus (e as opções dos filtros
 * saem dela). Com país ou competição escolhidos, as buscas `targeted` já vêm filtradas da API, para a
 * lista não depender da amostra: uma por competição, ou uma por esporte em cada país.
 */
export function upcomingScopes(
  filters: LiveFilters,
  sports: string[],
): { base: UpcomingScope[]; targeted: UpcomingScope[] } {
  const all = [...new Set([...sports, ...filters.sport])];
  const base = all.map((sport) => ({ sport }));
  if (filters.competition.length)
    return {
      base,
      targeted: filters.competition.slice(0, MAX_TARGETED_SCOPES).map((competition) => ({ competition })),
    };
  if (filters.country.length) {
    const inScope = filters.sport.length ? filters.sport : all;
    const targeted = filters.country.flatMap((country) => inScope.map((sport) => ({ sport, country })));
    return { base, targeted: targeted.slice(0, MAX_TARGETED_SCOPES) };
  }
  return { base, targeted: [] };
}

/** O que `combineUpcoming` lê de cada busca de próximos (resultado do `useQueries`). */
export interface UpcomingResult {
  data?: Event[];
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * Junta o resultado de várias buscas de próximos. As que falharam não entram em `data`, mas marcam
 * `error`: sem nada para mostrar, a seção avisa do erro em vez de dizer que nenhum jogo bate com os
 * filtros. `retry` refaz só as que falharam.
 */
export function combineUpcoming(results: UpcomingResult[]) {
  const failed = results.filter((r) => r.isError);
  return {
    data: results.flatMap((r) => r.data ?? []),
    pending: results.some((r) => r.isPending),
    error: failed.length > 0,
    retry: () => {
      for (const r of failed) void r.refetch();
    },
  };
}

export interface UpcomingGroup {
  sport: string;
  /** Jogos do esporte que passaram nos filtros (o total, antes do corte de exibição). */
  total: number;
  events: Event[];
}

/**
 * Próximos por esporte, sem repetidos e por horário, até `perSport` jogos em cada um. Os esportes seguem
 * `order` (mais jogos na semana primeiro); os que não estão nela vão para o fim.
 */
export function groupUpcoming(events: Event[], order: string[], perSport: number): UpcomingGroup[] {
  const seen = new Set<string>();
  const bySport = new Map<string, Event[]>();
  for (const e of [...events].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id),
  )) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    bySport.set(e.sport, [...(bySport.get(e.sport) ?? []), e]);
  }
  const rank = (s: string) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length : i;
  };
  return [...bySport.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([sport, list]) => ({ sport, total: list.length, events: list.slice(0, perSport) }));
}

// ─── ponte com o componente de filtros (ReUI): um chip por filtro, "é um destes" (a janela, "é") ───

const windowRule = (hours: string) =>
  createFilterRule<unknown>({
    id: 'window',
    path: ['window'],
    operator: WINDOW_FILTER_OPERATOR,
    value: hours,
  });

/** Com "Encerrados", o chip da janela aparece sempre, na padrão (12 h) quando nenhuma foi escolhida. */
export function toFilterQuery(filters: LiveFilters): FilterQuery {
  return createFilterQuery(
    LIVE_FILTER_FIELDS.flatMap((f) => {
      if (f === 'window')
        return filters.status.includes('finished') ? [windowRule(String(finishedWindowHours(filters)))] : [];
      return filters[f].length
        ? [
            createFilterRule<unknown>({
              id: f,
              path: [f],
              operator: LIVE_FILTER_OPERATOR,
              value: [...filters[f]],
            }),
          ]
        : [];
    }),
  );
}

/**
 * O chip da janela acompanha o de status: entra (na padrão) quando "Encerrados" é escolhido e sai quando
 * deixa de ser. Os demais chips ficam como estão (inclusive os ainda sem valor).
 */
export function syncWindowRule(query: FilterQuery): FilterQuery {
  const finished = fromFilterQuery(query).status.includes('finished');
  const hasWindow = query.rules.some((r) => r.type === 'rule' && r.path[0] === 'window');
  if (finished && !hasWindow) {
    const at = query.rules.findIndex((r) => r.type === 'rule' && r.path[0] === 'status') + 1;
    const rules = [...query.rules];
    rules.splice(at, 0, windowRule(String(DEFAULT_FINISHED_WINDOW)));
    return { ...query, rules };
  }
  if (!finished && hasWindow)
    return { ...query, rules: query.rules.filter((r) => !(r.type === 'rule' && r.path[0] === 'window')) };
  return query;
}

/** Só os chips completos (com algum valor) viram filtro; o chip recém-criado, ainda vazio, não. */
export function fromFilterQuery(query: FilterQuery): LiveFilters {
  const out: LiveFilters = { status: [], window: [], sport: [], country: [], competition: [] };
  for (const rule of flattenFilterRules(query)) {
    const field = rule.path[0] as LiveFilterField | undefined;
    if (!field || !LIVE_FILTER_FIELDS.includes(field)) continue;
    const raw = Array.isArray(rule.value) ? (rule.value as unknown[]) : [rule.value];
    const values = raw.filter((v): v is string => typeof v === 'string' && v !== '');
    if (!values.length) continue;
    if (field === 'status')
      out.status = values.filter((v): v is LiveStatus => (LIVE_STATUSES as string[]).includes(v));
    else out[field] = values;
  }
  out.window = normalizeWindow(out.status, out.window);
  return out;
}
