/** Bases das 12 APIs da api-sports. Uma chave do dashboard vale para todas; a cota é separada por API. */
export const API_HOSTS = {
  football: { base: 'https://v3.football.api-sports.io', version: 'v3' },
  afl: { base: 'https://v1.afl.api-sports.io', version: 'v1' },
  baseball: { base: 'https://v1.baseball.api-sports.io', version: 'v1' },
  basketball: { base: 'https://v1.basketball.api-sports.io', version: 'v1' },
  'formula-1': { base: 'https://v1.formula-1.api-sports.io', version: 'v1' },
  handball: { base: 'https://v1.handball.api-sports.io', version: 'v1' },
  hockey: { base: 'https://v1.hockey.api-sports.io', version: 'v1' },
  mma: { base: 'https://v1.mma.api-sports.io', version: 'v1' },
  nba: { base: 'https://v2.nba.api-sports.io', version: 'v2' },
  'american-football': { base: 'https://v1.american-football.api-sports.io', version: 'v1' },
  rugby: { base: 'https://v1.rugby.api-sports.io', version: 'v1' },
  volleyball: { base: 'https://v1.volleyball.api-sports.io', version: 'v1' },
} as const;

export type ApiSport = keyof typeof API_HOSTS;

export const API_SPORTS = Object.keys(API_HOSTS) as ApiSport[];
