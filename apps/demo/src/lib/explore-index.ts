/**
 * Números da home "Explorar" e das páginas que eles abrem (índice de esportes, índice de países, agenda e ao
 * vivo). Tudo sai do mesmo resumo (`/v1/explore/summary`), e a agenda (`/v1/explore/agenda`) conta com a
 * mesma consulta na API: o número do card e o da página são o mesmo número.
 */
import type { ExploreSport, ExploreSummary } from '@galaxie/contracts';

import { COUNTRIES, SPORTS } from './navigation';
import { SPORT_FAMILIES, familyHref, type SportFamily } from './sport-families';

/** Para onde cada número da home leva. */
export const EXPLORE_LINKS = {
  sports: '/esportes',
  countries: '/paises',
  upcoming: '/agenda',
  live: '/ao-vivo',
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
    countries: summary?.countries.length ?? COUNTRIES.length,
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

/** Filtros da agenda na URL (compartilháveis): `?esporte=football&pais=br&competicao=<slug>&dia=2026-10-25`. */
export interface AgendaParams {
  esporte?: string | null | undefined;
  pais?: string | null | undefined;
  competicao?: string | null | undefined;
  dia?: string | null | undefined;
}

export function agendaHref(params: AgendaParams): string {
  const query = new URLSearchParams();
  for (const key of ['esporte', 'pais', 'competicao', 'dia'] as const) {
    const value = params[key];
    if (value) query.set(key, key === 'pais' ? value.toLowerCase() : value);
  }
  return query.size ? `${EXPLORE_LINKS.upcoming}?${query}` : EXPLORE_LINKS.upcoming;
}

/** Lê os filtros da URL da agenda (valores inválidos viram ausência, sem erro). */
export function readAgendaParams(search: Record<string, string | string[] | undefined>): AgendaParams {
  const one = (key: string) => {
    const v = search[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const dia = one('dia');
  const pais = one('pais');
  return {
    esporte: one('esporte'),
    pais: pais && /^[a-z]{2}(-[a-z]{3})?$/i.test(pais) ? pais.toUpperCase() : null,
    competicao: one('competicao'),
    dia: dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null,
  };
}
