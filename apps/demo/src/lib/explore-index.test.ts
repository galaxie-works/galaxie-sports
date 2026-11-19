import type { ExploreSummary } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { agendaHref, EXPLORE_LINKS, exploreTotals, familyStats, readAgendaParams } from './explore-index';
import { FALLBACK_COUNTRIES, SPORTS } from './navigation';

const sport = (slug: string, competitions: number, upcoming: number, live: number) =>
  ({
    slug,
    name: slug,
    competitions,
    participants: 0,
    upcoming,
    live,
    top_competitions: [],
  }) as ExploreSummary['sports'][number];

const summary = {
  sports: [
    sport('football', 76, 500, 3),
    sport('basketball', 31, 40, 1),
    sport('nba', 1, 12, 0),
    sport('formula-1', 1, 0, 0),
  ],
  // 20 países no resumo (o banco), não os 17 da reserva
  countries: [
    ...FALLBACK_COUNTRIES.map((c) => ({ code: c.code })),
    { code: 'US' },
    { code: 'NL' },
    { code: 'SA' },
  ],
} as unknown as ExploreSummary;

describe('números da home e dos índices', () => {
  it('cada número leva à página que conta a mesma coisa', () => {
    expect(EXPLORE_LINKS).toEqual({
      sports: '/sports',
      countries: '/countries',
      upcoming: '/schedule',
      live: '/live',
    });
    expect(exploreTotals(summary)).toEqual({
      sports: SPORTS.length,
      countries: 20,
      upcoming: 552,
      live: 4,
    });
    // sem a API, a lista de reserva
    expect(exploreTotals(null)).toMatchObject({
      countries: FALLBACK_COUNTRIES.length,
      upcoming: null,
      live: null,
    });
  });

  it('a família soma os esportes dela, e a soma das famílias é o total da home', () => {
    const stats = familyStats(summary);
    const basquete = stats.find((s) => s.family.id === 'basquete')!;
    expect(basquete).toMatchObject({ href: '/sports/basketball', competitions: 32, upcoming: 52, live: 1 });
    expect(basquete.sports.map((s) => s.slug)).toEqual(['basketball', 'nba']);
    expect(stats.reduce((n, s) => n + s.upcoming, 0)).toBe(exploreTotals(summary).upcoming);
  });
});

describe('filtros da agenda na URL', () => {
  it('monta e lê os mesmos filtros (país em minúsculas na URL)', () => {
    const href = agendaHref({
      sport: 'football',
      country: 'GB-ENG',
      competition: 'premier-league',
      day: '2026-10-25',
    });
    expect(href).toBe('/schedule?sport=football&country=gb-eng&competition=premier-league&day=2026-10-25');
    const search = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(readAgendaParams(search)).toEqual({
      sport: 'football',
      country: 'GB-ENG',
      competition: 'premier-league',
      day: '2026-10-25',
    });
    expect(agendaHref({})).toBe('/schedule');
  });

  it('valor inválido vira ausência', () => {
    expect(readAgendaParams({ country: 'brasil', day: 'amanhã', sport: ['a', 'b'] })).toEqual({
      sport: null,
      country: null,
      competition: null,
      day: null,
    });
  });
});
