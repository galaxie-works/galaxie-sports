import { describe, expect, it } from 'vitest';
import type { CatalogCompetition } from './catalog-config.js';
import {
  buildCatalogRows,
  checkCatalog,
  countryCode,
  mergeSameYear,
  seasonLabel,
  slugify,
  type ApiLeague,
} from './football-catalog.js';

const coverage = { standings: true };
export const LEAGUES: ApiLeague[] = [
  {
    league: {
      id: 71,
      name: 'Serie A',
      type: 'League',
      logo: 'https://media.api-sports.io/football/leagues/71.png',
    },
    country: { name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
    seasons: [
      { year: 2025, start: '2025-03-29', end: '2025-12-21', current: false, coverage },
      { year: 2026, start: '2026-01-28', end: '2026-12-02', current: true, coverage },
    ],
  },
  {
    league: {
      id: 39,
      name: 'Premier League',
      type: 'League',
      logo: 'https://media.api-sports.io/football/leagues/39.png',
    },
    country: { name: 'England', code: 'GB-ENG', flag: 'https://media.api-sports.io/flags/gb-eng.svg' },
    seasons: [{ year: 2026, start: '2026-08-15', end: '2027-05-23', current: true, coverage }],
  },
  {
    league: {
      id: 13,
      name: 'CONMEBOL Libertadores',
      type: 'Cup',
      logo: 'https://media.api-sports.io/football/leagues/13.png',
    },
    country: { name: 'World', code: null, flag: null },
    seasons: [{ year: 2026, start: '2026-02-03', end: '2026-11-28', current: true, coverage }],
  },
  {
    league: { id: 9999, name: 'Copa Estadual Teste', type: 'Cup', logo: null },
    country: { name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
    seasons: [],
  },
];

const CATALOG: CatalogCompetition[] = [
  {
    slug: 'brasileirao-serie-a',
    name: 'Serie A',
    country: 'Brazil',
    type: 'league',
    api_sports_id: 71,
    tier: 1,
    live_priority: 'high',
    labels: { 'pt-BR': 'Brasileirão Série A' },
  },
  {
    slug: 'libertadores',
    name: 'CONMEBOL Libertadores',
    country: 'World',
    type: 'cup',
    api_sports_id: 13,
    tier: 1,
  },
  {
    slug: 'premier-league',
    name: 'Premier League',
    country: 'Scotland',
    type: 'league',
    api_sports_id: 39,
    tier: 1,
  },
  {
    slug: 'fantasma',
    name: 'Liga Fantasma',
    country: 'Brazil',
    type: 'league',
    api_sports_id: 123456,
    tier: 2,
  },
  { slug: 'sem-id', name: 'Sem ID', country: 'Brazil', type: 'cup', api_sports_id: null, tier: 2 },
];

describe('normalização', () => {
  it('slugify remove acentos e pontuação', () => {
    expect(slugify('Paulista - A1 (São Paulo)')).toBe('paulista-a1-sao-paulo');
  });

  it('códigos de país: ISO, extensões e World', () => {
    expect(countryCode({ name: 'Brazil', code: 'br' })).toBe('BR');
    expect(countryCode({ name: 'England', code: 'GB-ENG' })).toBe('GB-ENG');
    expect(countryCode({ name: 'World', code: null })).toBe('WORLD');
  });

  it('rótulo de temporada segue o calendário da competição', () => {
    expect(seasonLabel({ year: 2026, start: '2026-01-28', end: '2026-12-02' })).toBe('2026');
    expect(seasonLabel({ year: 2026, start: '2026-08-15', end: '2027-05-23' })).toBe('2026/27');
  });

  it('aplica slug, tier, prioridade e labels do catálogo; o resto vira tier 3 com slug estável', () => {
    const rows = buildCatalogRows(LEAGUES, [{ name: 'Brazil', code: 'BR', flag: null }], CATALOG);
    const serieA = rows.competitions.find((c) => c.providerId === '71')!;
    expect(serieA).toMatchObject({
      slug: 'brasileirao-serie-a',
      tier: 1,
      livePriority: 'high',
      type: 'league',
      countryCode: 'BR',
      labels: { 'pt-BR': 'Brasileirão Série A' },
    });
    expect(serieA.seasons.map((s) => s.label)).toEqual(['2025', '2026']);
    const other = rows.competitions.find((c) => c.providerId === '9999')!;
    expect(other).toMatchObject({
      slug: 'brazil-copa-estadual-teste-9999',
      tier: 3,
      type: 'cup',
      livePriority: 'none',
    });
    expect(rows.countries.map((c) => c.code).sort()).toEqual(['BR', 'GB-ENG', 'WORLD']);
    // bandeira vinda de /leagues não é perdida quando /countries trouxe null
    expect(rows.countries.find((c) => c.code === 'BR')?.flagUrl).toBe(
      'https://media.api-sports.io/flags/br.svg',
    );
  });
});

describe('checkCatalog', () => {
  it('classifica ok, divergência, ausente e sem ID', () => {
    const byslug = Object.fromEntries(checkCatalog(CATALOG, LEAGUES).map((c) => [c.slug, c]));
    expect(byslug['brasileirao-serie-a']).toMatchObject({ status: 'ok', currentSeason: 2026 });
    expect(byslug['libertadores']?.status).toBe('ok');
    expect(byslug['premier-league']).toMatchObject({ status: 'mismatch' });
    expect(byslug['premier-league']?.details).toContain('England');
    expect(byslug['fantasma']?.status).toBe('missing');
    expect(byslug['sem-id']?.status).toBe('unverified');
  });
});

describe('mergeSameYear', () => {
  it('une duas edições com o mesmo ano (mudança de calendário) numa temporada só', () => {
    const merged = mergeSameYear([
      { year: 2018, start: '2018-10-27', end: '2019-05-19', current: false, coverage: { v: 'nova' } },
      { year: 2018, start: '2018-02-10', end: '2018-09-02', current: false, coverage: { v: 'antiga' } },
      { year: 2019, start: '2019-10-01', end: '2020-05-01', current: true, coverage: {} },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      year: 2018,
      start: '2018-02-10',
      end: '2019-05-19',
      current: false,
      coverage: { v: 'nova' },
    });
  });
});
