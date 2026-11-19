/**
 * Números da home "Explorar" e das páginas que eles abrem (índice de esportes, índice de países, agenda e ao
 * vivo). Tudo sai do mesmo resumo (`/v1/explore/summary`), e a agenda (`/v1/explore/agenda`) conta com a
 * mesma consulta na API: o número do card e o da página são o mesmo número.
 */
import type { ExploreSport, ExploreSummary } from '@galaxie/contracts';

import { FALLBACK_COUNTRIES, SPORTS } from './navigation';
import { SPORT_FAMILIES, familyHref, type SportFamily } from './sport-families';

/** Para onde cada número da home leva. */
export const EXPLORE_LINKS = {
  sports: '/sports',
  countries: '/countries',
  upcoming: '/schedule',
  live: '/live',
} as const;

export interface ExploreTotals {
  sports: number;
  countries: number;
  /** null sem o resumo (a home segue navegando, sem os contadores de jogos). */
  upcoming: number | null;
  live: number | null;
}

/** Os quatro números do topo da home (e dos índices). */
export function exploreTotals(summary: ExploreSummary | null): ExploreTotals {
  return {
    sports: SPORTS.length,
    // os países vêm do resumo (do banco); a reserva só sem a API
    countries: summary?.countries.length ?? FALLBACK_COUNTRIES.length,
    upcoming: summary ? summary.sports.reduce((n, s) => n + s.upcoming, 0) : null,
    live: summary ? summary.sports.reduce((n, s) => n + s.live, 0) : null,
  };
}

export interface FamilyStats {
  family: SportFamily;
  href: string;
  /** Os esportes da família, com os números do resumo de cada um (sem resumo, undefined). */
  sports: { slug: SportFamily['sports'][number]; data: ExploreSport | undefined }[];
  competitions: number;
  upcoming: number;
  live: number;
}

/** Os esportes do resumo agrupados como no menu: os números da família são a soma dos esportes dela. */
export function familyStats(summary: ExploreSummary | null): FamilyStats[] {
  const bySlug = new Map(summary?.sports.map((s) => [s.slug, s]));
  return SPORT_FAMILIES.map((family) => {
    const sports = family.sports.map((slug) => ({ slug, data: bySlug.get(slug) }));
    const sum = (key: 'competitions' | 'upcoming' | 'live') =>
      sports.reduce((n, s) => n + (s.data?.[key] ?? 0), 0);
    return {
      family,
      href: familyHref(family),
      sports,
      competitions: sum('competitions'),
      upcoming: sum('upcoming'),
      live: sum('live'),
    };
  });
}

/** Filtros da agenda na URL (compartilháveis): `?sport=football&country=br&competition=<slug>&day=2026-10-25`. */
export interface AgendaParams {
  sport?: string | null | undefined;
  country?: string | null | undefined;
  competition?: string | null | undefined;
  day?: string | null | undefined;
}

export function agendaHref(params: AgendaParams): string {
  const query = new URLSearchParams();
  for (const key of ['sport', 'country', 'competition', 'day'] as const) {
    const value = params[key];
    if (value) query.set(key, key === 'country' ? value.toLowerCase() : value);
  }
  return query.size ? `${EXPLORE_LINKS.upcoming}?${query}` : EXPLORE_LINKS.upcoming;
}

/** Lê os filtros da URL da agenda (valores inválidos viram ausência, sem erro). */
export function readAgendaParams(search: Record<string, string | string[] | undefined>): AgendaParams {
  const one = (key: string) => {
    const v = search[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const day = one('day');
  const country = one('country');
  return {
    sport: one('sport'),
    country: country && /^[a-z]{2}(-[a-z]{3})?$/i.test(country) ? country.toUpperCase() : null,
    competition: one('competition'),
    day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
  };
}
