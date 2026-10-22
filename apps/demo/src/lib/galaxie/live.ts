/**
 * Leituras ao vivo no navegador, pelo proxy autenticado `/api/galaxie/*` (a chave fica no servidor).
 * Ao contrário de `api.ts` (Server Components com `use cache`), aqui tudo é buscado sem cache: o
 * ritmo de atualização é controlado por `useLiveRefresh` (SSE + verificação periódica).
 */
import type { Event, EventTimeline, Page } from '@galaxie/contracts';

import { apiLocale, apiTimeZone, defaultMarket, type Locale } from '../i18n/config';

/** Eventos ao vivo por relevância: compartilhado pela sidebar (contador) e pela página Ao vivo. */
export const LIVE_EVENTS_KEY = ['live-events'] as const;
export const timelineKey = (id: string) => ['event-timeline', id] as const;
export const UPCOMING_KEY = ['upcoming-events'] as const;

async function getJson<T>(
  locale: Locale,
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

export async function fetchTimeline(id: string, locale: Locale): Promise<EventTimeline> {
  return getJson<EventTimeline>(locale, `/v1/events/${encodeURIComponent(id)}/timeline`);
}

/** Próximos apitos (para o estado vazio do Ao vivo). `from` é o instante atual, calculado na busca. */
export async function fetchUpcoming(locale: Locale, limit = 6): Promise<Event[]> {
  const page = await getJson<Page<Event>>(locale, '/v1/events', {
    from: new Date().toISOString(),
    status: 'scheduled,starting',
    order: 'starts_at',
    limit,
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
