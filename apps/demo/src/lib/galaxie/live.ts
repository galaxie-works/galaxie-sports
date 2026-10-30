/**
 * Leituras ao vivo no navegador, pelo proxy autenticado `/api/galaxie/*` (a chave fica no servidor).
 * Ao contrário de `api.ts` (Server Components com `use cache`), aqui tudo é buscado sem cache: o
 * ritmo de atualização é controlado por `useLiveRefresh` (SSE + verificação periódica).
 */
import type { Event, EventTimeline, ExploreAgenda, Page } from '@galaxie/contracts';

import { apiLocale, apiTimeZone, defaultMarket, type ContentLocale, type Locale } from '../i18n/config';

/** Eventos ao vivo por relevância: compartilhado pela sidebar (contador) e pela página Ao vivo. */
export const LIVE_EVENTS_KEY = ['live-events'] as const;
export const timelineKey = (id: string) => ['event-timeline', id] as const;

async function getJson<T>(
  locale: ContentLocale,
  path: string,
  query: Record<string, string | number> = {},
): Promise<T> {
  const params = new URLSearchParams({ locale: apiLocale(locale), tz: apiTimeZone(locale) });
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  // sem cache do navegador: a API já serve do Valkey e é purgada a cada mudança
  const res = await fetch(`/api/galaxie${path}?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} respondeu ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchLiveEvents(locale: Locale): Promise<Event[]> {
  return (await getJson<{ data: Event[] }>(locale, '/v1/events/live', { market: defaultMarket(locale) }))
    .data;
}

/** Ao vivo de um país (competição ou participante do país, a mesma conta do card em Países). */
export const countryLiveKey = (code: string, content: string) =>
  ['country-live-events', code, content] as const;

/** `content`: o idioma do conteúdo da página do país (`contentLocale`), o mesmo das competições. */
export async function fetchCountryLiveEvents(
  locale: Locale,
  content: ContentLocale,
  code: string,
): Promise<Event[]> {
  return (
    await getJson<{ data: Event[] }>(content, '/v1/events/live', {
      market: defaultMarket(locale),
      country: code,
    })
  ).data;
}

export async function fetchTimeline(id: string, locale: ContentLocale): Promise<EventTimeline> {
  return getJson<EventTimeline>(locale, `/v1/events/${encodeURIComponent(id)}/timeline`);
}

/** Esportes com jogo nos próximos dias, com a contagem: as facetas da agenda (`/v1/explore/agenda`). */
export const UPCOMING_SPORTS_KEY = ['upcoming-sports'] as const;

export async function fetchUpcomingSports(locale: Locale): Promise<{ slug: string; count: number }[]> {
  // limit=1: só as facetas interessam (os jogos do dia vêm de `fetchUpcoming`, por esporte)
  const agenda = await getJson<ExploreAgenda>(locale, '/v1/explore/agenda', { limit: 1 });
  return agenda.facets.sports.filter((s) => s.count > 0);
}

/** Recorte de uma busca de próximos: um esporte, um esporte num país ou uma competição. */
export interface UpcomingScope {
  sport?: string;
  country?: string;
  competition?: string;
}

export const upcomingKey = (scope: UpcomingScope) =>
  ['upcoming-events', scope.sport ?? '', scope.country ?? '', scope.competition ?? ''] as const;

/** Próximos apitos de um recorte (a seção "Próximos" do Ao vivo). `from` é o instante atual, calculado na busca. */
export async function fetchUpcoming(locale: Locale, scope: UpcomingScope, limit: number): Promise<Event[]> {
  const filters = Object.fromEntries(Object.entries(scope).filter(([, v]) => !!v)) as Record<string, string>;
  const page = await getJson<Page<Event>>(locale, '/v1/events', {
    from: new Date().toISOString(),
    status: 'scheduled,starting',
    order: 'starts_at',
    limit,
    ...filters,
  });
  return page.data;
}

export const finishedKey = (scope: UpcomingScope, hours: number) =>
  ['finished-events', hours, scope.sport ?? '', scope.country ?? '', scope.competition ?? ''] as const;

/**
 * Encerrados de um recorte (a seção "Encerrados" do Ao vivo): jogos que começaram nas últimas `hours` horas
 * e já terminaram, dos mais importantes para os menos. O início da janela é arredondado ao minuto, para
 * buscas seguidas caírem no mesmo cache da API.
 */
export async function fetchFinished(
  locale: Locale,
  scope: UpcomingScope,
  hours: number,
  limit: number,
): Promise<Event[]> {
  const filters = Object.fromEntries(Object.entries(scope).filter(([, v]) => !!v)) as Record<string, string>;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const page = await getJson<Page<Event>>(locale, '/v1/events', {
    from: new Date(minute - hours * 3600_000).toISOString(),
    status: 'finished',
    order: 'importance',
    limit,
    ...filters,
  });
  return page.data;
}

/** Relevância do evento para ordenar: `relevance.score` no mercado pedido ou a `importance` global (0–100). */
export function relevanceOf(e: Event): number {
  return e.relevance?.score ?? e.importance;
}

/** "Ao vivo" com dado de verdade: o fornecedor já confirmou o jogo (não é só o horário que passou). */
export function hasLiveData(e: Event): boolean {
  return e.score.home != null || e.score.away != null || (e.clock?.minute ?? null) != null;
}
