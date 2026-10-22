/**
 * Leituras da API Galaxie Sports para as páginas (Server Components).
 * Cada função é cacheada (`use cache`): os metadados mudam pouco e a demo precisa navegar sem espera.
 */
import { createGalaxieClient, GalaxieApiError } from '@galaxie/contracts';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';

import { apiLocale, apiTimeZone, defaultMarket, type Locale } from '../i18n/config';
import { getDictionary } from '../i18n/dictionary';
import { fill } from '../i18n/text';

import type { ApiRequest } from './request';
import { API_URL } from './server';

/**
 * `locale` e `tz` da API para o idioma da demo (a API não fala inglês: `en` pede `es-AR`). Cada fetcher
 * recebe o idioma, que entra na chave do cache.
 */
export const localeQuery = (locale: Locale) => ({ locale: apiLocale(locale), tz: apiTimeZone(locale) });

/**
 * Descritores das chamadas (botão "Ver código" das seções): cada um fica ao lado do fetcher que faz a
 * mesma requisição, com o mesmo `locale` e `tz`, e a descrição no idioma da demo.
 */
const text = (locale: Locale) => getDictionary(locale).requests;

const api = createGalaxieClient({ baseUrl: API_URL, apiKey: process.env.GALAXIE_DEMO_KEY ?? '' });

/** 404 da API vira a página "não encontrado"; os demais erros sobem. */
async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof GalaxieApiError && err.status === 404) notFound();
    throw err;
  }
}

/** Para blocos opcionais da página: sem dado (404) não é erro, só ausência. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof GalaxieApiError && err.status === 404) return null;
    throw err;
  }
}

// ─── país ────────────────────────────────────────────────────────────────────────────────────────

export const countryCompetitionsRequest = (code: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/countries/{code}/competitions',
  params: { code: code.toUpperCase() },
  query: localeQuery(locale),
  description: text(locale).countryCompetitions,
});

export async function getCountryCompetitions(code: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.countryCompetitions(code, localeQuery(locale)));
}

// ─── esporte ─────────────────────────────────────────────────────────────────────────────────────

export const sportCompetitionsRequest = (sport: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/competitions',
  query: { sport, tier: 1, limit: 200, ...localeQuery(locale) },
  description: text(locale).sportCompetitions,
  note: text(locale).sportCompetitionsNote,
});

/** Competições catalogadas (tier 1–2) de um esporte; o tier 3 é só espelho e fica de fora da vitrine. */
export async function getSportCompetitions(sport: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  const all = [];
  for (const tier of [1, 2]) {
    let cursor: string | undefined;
    do {
      const page = await api.competitions({ sport, tier, limit: 200, cursor, ...localeQuery(locale) });
      all.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  return all;
}

// ─── competição ──────────────────────────────────────────────────────────────────────────────────

export const competitionRequest = (idOrSlug: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/competitions/{id}',
  params: { id: idOrSlug },
  query: localeQuery(locale),
  description: text(locale).competition,
});

export async function getCompetition(idOrSlug: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.competition(idOrSlug, localeQuery(locale)));
}

export const standingsRequest = (competitionId: string, season: number, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/competitions/{id}/seasons/{season}/standings',
  params: { id: competitionId, season },
  query: localeQuery(locale),
  description: text(locale).standings,
});

export async function getStandings(competitionId: string, season: number, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNull(api.standings(competitionId, season, localeQuery(locale)));
}

export interface SeasonWindow {
  year: number;
  start: string;
  end: string;
}

/** Temporadas que têm classificação ou jogos (na ordem recebida). */
export async function getSeasonsWithData(competitionId: string, seasons: SeasonWindow[], locale: Locale) {
  'use cache';
  cacheLife('hours');
  const checks = await Promise.all(
    seasons.map(async (s) => {
      const [standings, events] = await Promise.all([
        orNull(api.standings(competitionId, s.year, localeQuery(locale))),
        api.events({
          competition: competitionId,
          from: s.start,
          to: s.end,
          limit: 1,
          ...localeQuery(locale),
        }),
      ]);
      const hasStandings = (standings?.groups ?? []).some((g) => g.rows.length > 0);
      return { year: s.year, hasStandings, hasEvents: events.data.length > 0 };
    }),
  );
  return checks.filter((c) => c.hasStandings || c.hasEvents);
}

export const competitionEventsRequest = (
  competitionId: string,
  from: string,
  to: string,
  locale: Locale,
): ApiRequest => ({
  method: 'GET',
  route: '/v1/events',
  query: { competition: competitionId, from, to, limit: 200, ...localeQuery(locale) },
  description: text(locale).competitionEvents,
  note: text(locale).competitionEventsNote,
});

/** Todos os jogos de uma janela (segue o cursor; a API devolve até 200 por página). */
export async function getCompetitionEvents(competitionId: string, from: string, to: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await api.events({
      competition: competitionId,
      from,
      to,
      limit: 200,
      cursor,
      ...localeQuery(locale),
    });
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && all.length < 2000);
  return all;
}

// ─── time ────────────────────────────────────────────────────────────────────────────────────────

export const teamOverviewRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/teams/{id}/overview',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).teamOverview,
});

export async function getTeamOverview(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.teamOverview(id, localeQuery(locale)));
}

export const teamSemanticRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/teams/{id}/semantic',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).teamSemantic,
  note: fill(text(locale).requiresModule, { module: 'semantic' }),
});

export async function getTeamSemantic(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNull(api.teamSemantic(id, localeQuery(locale)));
}

export const squadRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/teams/{id}/squad',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).squad,
});

export async function getSquad(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNull(api.squad(id, localeQuery(locale)));
}

// ─── evento ──────────────────────────────────────────────────────────────────────────────────────

export const eventRequest = (id: string, locale: Locale, market?: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}',
  params: { id },
  query: market ? { market, ...localeQuery(locale) } : localeQuery(locale),
  description: text(locale).event,
});

/** Evento com a relevância no mercado (país ISO2) pedido. */
export async function getEvent(id: string, locale: Locale, market?: string) {
  'use cache';
  cacheLife('minutes');
  return orNotFound(api.event(id, { ...localeQuery(locale), ...(market ? { market } : {}) }));
}

export const liveEventsRequest = (locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/live',
  query: { market: defaultMarket(locale), ...localeQuery(locale) },
  description: text(locale).liveEvents,
  note: text(locale).liveEventsNote,
});

export const timelineRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/timeline',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).timeline,
});

export async function getTimeline(id: string, locale: Locale) {
  'use cache';
  cacheLife('seconds');
  return orNull(api.eventTimeline(id, localeQuery(locale)));
}

export const h2hRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/h2h',
  params: { id },
  query: { limit: 10, ...localeQuery(locale) },
  description: text(locale).h2h,
});

export async function getH2h(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNull(api.eventH2h(id, { limit: 10, ...localeQuery(locale) }));
}

export const eventContextRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/context',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).eventContext,
  note: fill(text(locale).requiresModule, { module: 'live_intelligence' }),
});

export async function getEventContext(id: string, locale: Locale) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventContext(id, localeQuery(locale)));
}

export const whereToWatchRequest = (id: string, country: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/where-to-watch',
  params: { id },
  query: { country, ...localeQuery(locale) },
  description: text(locale).whereToWatch,
  note: text(locale).whereToWatchNote,
});

export async function getWhereToWatch(id: string, country: string, locale: Locale) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.whereToWatch(id, country, localeQuery(locale)));
}

export const relatedRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/related',
  params: { id },
  query: { limit: 50, ...localeQuery(locale) },
  description: text(locale).related,
  note: fill(text(locale).requiresModule, { module: 'related_content' }),
});

/** Vídeos relacionados (módulo add-on related_content): sem o módulo (403) a seção só não aparece. */
export async function getRelated(id: string, locale: Locale) {
  'use cache';
  cacheLife('minutes');
  try {
    return await orNull(api.eventRelated(id, { limit: 50, ...localeQuery(locale) }));
  } catch (err) {
    if (err instanceof GalaxieApiError && err.status === 403) return null;
    throw err;
  }
}

export const lineupsRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/lineups',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).lineups,
});

export async function getLineups(id: string, locale: Locale) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventLineups(id, localeQuery(locale)));
}

export const statsRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/stats',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).stats,
});

/** Estatísticas do jogo (códigos estáveis e rótulo no idioma pedido à API). */
export async function getStats(id: string, locale: Locale) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventStats(id, localeQuery(locale)));
}

// ─── pessoas e locais ────────────────────────────────────────────────────────────────────────────

export const personRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/people/{id}',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).person,
});

export async function getPerson(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.person(id, localeQuery(locale)));
}

export const venueRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/venues/{id}',
  params: { id },
  query: localeQuery(locale),
  description: text(locale).venue,
});

export async function getVenue(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.venue(id, localeQuery(locale)));
}

export const derbyRequest = (slug: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/derbies/{slug}',
  params: { slug },
  query: localeQuery(locale),
  description: text(locale).derby,
  note: fill(text(locale).requiresModule, { module: 'semantic' }),
});

export async function getDerby(slug: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.derby(slug, localeQuery(locale)));
}
