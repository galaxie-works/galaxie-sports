import type { SportCatalogCompetition } from '../src/catalog/catalog-config.js';

const cov = { standings: true };

/** Formato v1 clássico (basquete), com o country.code " " que o fornecedor devolve para "World". */
export const BASKETBALL_LEAGUES = [
  {
    id: 26,
    name: 'NBB',
    type: 'League',
    logo: 'https://media.api-sports.io/basketball/leagues/26.png',
    country: { id: 10, name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
    seasons: [
      { season: '2024-2025', start: '2024-10-12', end: '2025-06-18', coverage: cov },
      { season: '2026-2027', start: '2026-10-10', end: '2027-06-01', coverage: cov },
      { season: '2022-2023', start: '2022-10-01', end: '2023-06-01', coverage: cov },
    ],
  },
  {
    id: 192,
    name: 'Olympic Games',
    type: 'cup',
    logo: 'https://media.api-sports.io/basketball/leagues/192.png',
    country: { id: 1, name: 'World', code: ' ', flag: null },
    seasons: [{ season: 2024, start: '2024-07-27', end: '2024-08-11', coverage: cov }],
  },
  {
    id: 414,
    name: 'South American League',
    type: 'League',
    logo: null,
    country: { id: 2, name: 'South-America', code: null, flag: null },
    seasons: [{ season: 2023, start: '2023-10-01', end: '2023-12-01', coverage: cov }],
  },
];

export const BASKETBALL_COUNTRIES = [
  { id: 10, name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' },
  { id: 11, name: 'Asia', code: 'AS', flag: 'https://media.api-sports.io/flags/as.svg' },
];

export const BASKETBALL_CATALOG: SportCatalogCompetition[] = [
  {
    slug: 'nbb',
    name: 'NBB',
    country: 'Brazil',
    type: 'league',
    api_sports_id: 26,
    tier: 1,
    seasons_strategy: 'split-year',
    live_priority: 'high',
    labels: { 'pt-BR': 'NBB (Novo Basquete Brasil)' },
  },
  {
    slug: 'olympics-basketball',
    name: 'Olympic Games',
    country: 'World',
    type: 'cup',
    api_sports_id: 192,
    tier: 1,
  },
  { slug: 'fantasma', name: 'Liga X', country: 'Chile', type: 'league', api_sports_id: 9999, tier: 2 },
  { slug: 'a-resolver', name: 'Liga Y', country: 'Peru', type: 'league', api_sports_id: null, tier: 2 },
];
