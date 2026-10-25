import type { ExploreSummary } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { agendaHref, EXPLORE_LINKS, exploreTotals, familyStats, readAgendaParams } from './explore-index';
import { COUNTRIES, SPORTS } from './navigation';

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
  countries: COUNTRIES.map((c) => ({ code: c.code })),
} as unknown as ExploreSummary;

describe('números da home e dos índices', () => {
  it('cada número leva à página que conta a mesma coisa', () => {
    expect(EXPLORE_LINKS).toEqual({
      sports: '/esportes',
      countries: '/paises',
      upcoming: '/agenda',
      live: '/ao-vivo',
    });
    expect(exploreTotals(summary)).toEqual({
      sports: SPORTS.length,
      countries: COUNTRIES.length,
      upcoming: 552,
      live: 4,
    });
    expect(exploreTotals(null)).toMatchObject({ upcoming: null, live: null });
  });

  it('a família soma os esportes dela, e a soma das famílias é o total da home', () => {
    const stats = familyStats(summary);
    const basquete = stats.find((s) => s.family.id === 'basquete')!;
    expect(basquete).toMatchObject({ href: '/esportes/basquete', competitions: 32, upcoming: 52, live: 1 });
    expect(basquete.sports.map((s) => s.slug)).toEqual(['basketball', 'nba']);
    expect(stats.reduce((n, s) => n + s.upcoming, 0)).toBe(exploreTotals(summary).upcoming);
  });
});

describe('filtros da agenda na URL', () => {
  it('monta e lê os mesmos filtros (país em minúsculas na URL)', () => {
    const href = agendaHref({
      esporte: 'football',
      pais: 'GB-ENG',
      competicao: 'premier-league',
      dia: '2026-10-25',
    });
    expect(href).toBe('/agenda?esporte=football&pais=gb-eng&competicao=premier-league&dia=2026-10-25');
    const search = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(readAgendaParams(search)).toEqual({
      esporte: 'football',
      pais: 'GB-ENG',
      competicao: 'premier-league',
      dia: '2026-10-25',
    });
    expect(agendaHref({})).toBe('/agenda');
  });

  it('valor inválido vira ausência', () => {
    expect(readAgendaParams({ pais: 'brasil', dia: 'amanhã', esporte: ['a', 'b'] })).toEqual({
      esporte: null,
      pais: null,
      competicao: null,
      dia: null,
    });
  });
});
