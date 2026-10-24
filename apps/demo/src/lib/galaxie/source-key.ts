/**
 * Nomes das leituras da fonte de dados e a chave de cada uma na cópia gravada do exemplo público. Sem
 * dependência da API: o exemplo (`lib/example/snapshot.ts`) usa só isto.
 */
export const FETCHER_NAMES = [
  'getCompetition',
  'getCompetitionEvents',
  'getEvent',
  'getEventCard',
  'getEventContext',
  'getH2h',
  'getLineups',
  'getPersonOverview',
  'getRelated',
  'getSeasonsWithData',
  'getSquad',
  'getStandings',
  'getStats',
  'getTeamCareer',
  'getTeamCountry',
  'getTeamEditorial',
  'getTeamOverview',
  'getTeamPhotos',
  'getTeamSemantic',
  'getTeamTraits',
  'getTimeline',
  'getWhereToWatch',
] as const;

export type FetcherName = (typeof FETCHER_NAMES)[number];

/** Chave de uma leitura: o nome e os argumentos (`undefined` vira `null`). */
export const snapshotKey = (name: string, args: unknown[]) =>
  `${name}(${args.map((a) => JSON.stringify(a ?? null)).join(',')})`;
