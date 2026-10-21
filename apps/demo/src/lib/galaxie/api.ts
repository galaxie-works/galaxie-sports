/**
 * Leituras da API Galaxie Sports para as páginas (Server Components).
 * Cada função é cacheada (`use cache`): os metadados mudam pouco e a demo precisa navegar sem espera.
 */
import { createGalaxieClient, GalaxieApiError } from '@galaxie/contracts';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';

import { API_URL } from './server';

export const LOCALE = 'pt-BR';
export const TZ = 'America/Sao_Paulo';

const api = createGalaxieClient({
  baseUrl: API_URL,
  apiKey: process.env.GALAXIE_DEMO_KEY ?? '',
  locale: LOCALE,
  tz: TZ,
});

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

export async function getCountryCompetitions(code: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.countryCompetitions(code));
}

// ─── competição ──────────────────────────────────────────────────────────────────────────────────

export async function getCompetition(idOrSlug: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.competition(idOrSlug));
}

export async function getStandings(competitionId: string, season: number) {
  'use cache';
  cacheLife('hours');
  return orNull(api.standings(competitionId, season));
}

export interface SeasonWindow {
  year: number;
  start: string;
  end: string;
}

/** Temporadas que têm classificação ou jogos (na ordem recebida). */
export async function getSeasonsWithData(competitionId: string, seasons: SeasonWindow[]) {
  'use cache';
  cacheLife('hours');
  const checks = await Promise.all(
    seasons.map(async (s) => {
      const [standings, events] = await Promise.all([
        orNull(api.standings(competitionId, s.year)),
        api.events({ competition: competitionId, from: s.start, to: s.end, limit: 1 }),
      ]);
      const hasStandings = (standings?.groups ?? []).some((g) => g.rows.length > 0);
      return { year: s.year, hasStandings, hasEvents: events.data.length > 0 };
    }),
  );
  return checks.filter((c) => c.hasStandings || c.hasEvents);
}

/** Todos os jogos de uma janela (segue o cursor; a API devolve até 200 por página). */
export async function getCompetitionEvents(competitionId: string, from: string, to: string) {
  'use cache';
  cacheLife('hours');
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await api.events({ competition: competitionId, from, to, limit: 200, cursor });
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && all.length < 2000);
  return all;
}

// ─── time ────────────────────────────────────────────────────────────────────────────────────────

export async function getTeamOverview(id: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.teamOverview(id));
}

export async function getTeamSemantic(id: string) {
  'use cache';
  cacheLife('hours');
  return orNull(api.teamSemantic(id));
}

export async function getSquad(id: string) {
  'use cache';
  cacheLife('hours');
  return orNull(api.squad(id));
}

// ─── evento ──────────────────────────────────────────────────────────────────────────────────────

export async function getEvent(id: string) {
  'use cache';
  cacheLife('minutes');
  return orNotFound(api.event(id));
}

export async function getH2h(id: string) {
  'use cache';
  cacheLife('hours');
  return orNull(api.eventH2h(id, { limit: 10 }));
}

export async function getEventContext(id: string) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventContext(id));
}

export async function getWhereToWatch(id: string, country: string) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.whereToWatch(id, country));
}

export async function getLineups(id: string) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventLineups(id));
}

// ─── pessoas e locais ────────────────────────────────────────────────────────────────────────────

export async function getPerson(id: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.person(id));
}

export async function getVenue(id: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.venue(id));
}

export async function getDerby(slug: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.derby(slug));
}
