import type { Params } from './request-hash.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Resposta que não muda mais (jogo antigo, temporada encerrada). */
export const FOREVER = Number.POSITIVE_INFINITY;

const REFERENCE = new Set([
  '/timezone',
  '/countries',
  '/leagues',
  '/leagues/seasons',
  '/seasons',
  '/teams/countries',
  '/odds/bookmakers',
  '/odds/bets',
  '/odds/live/bets',
]);

const SLOW_ENTITIES = new Set([
  '/teams',
  '/venues',
  '/coachs',
  '/transfers',
  '/trophies',
  '/sidelined',
  '/players/squads',
  '/players/teams',
  '/players/profiles',
  '/players/seasons',
  '/teams/seasons',
  '/fixtures/headtohead',
  '/games/h2h',
  '/drivers',
  '/circuits',
  '/fighters',
]);

/** Endpoints de "partidas" nos vários esportes. */
const MATCHES = new Set(['/fixtures', '/games', '/fights', '/races']);

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Por quanto tempo uma resposta já gravada no raw pode ser reutilizada sem nova chamada (docs/03 §4).
 * Valores conservadores: errar para o lado de gastar menos cota.
 */
export function ttlFor(endpoint: string, params: Params = {}, now: Date = new Date()): number {
  if (REFERENCE.has(endpoint)) return DAY;
  if (SLOW_ENTITIES.has(endpoint)) return 7 * DAY;

  if (MATCHES.has(endpoint)) {
    if (params.live !== undefined) return 10_000;
    if (typeof params.date === 'string') {
      const days = Math.round((Date.parse(`${params.date}T00:00:00Z`) - utcDay(now)) / DAY);
      if (days <= -2) return FOREVER;
      if (days === -1) return 30 * MIN;
      return 5 * MIN;
    }
    if (params.season !== undefined) {
      const year = Number(String(params.season).slice(0, 4));
      return year < now.getUTCFullYear() - 1 ? FOREVER : HOUR;
    }
    if (params.id !== undefined || params.ids !== undefined) return MIN;
    return 5 * MIN;
  }

  switch (endpoint) {
    case '/standings':
      return HOUR;
    case '/injuries':
      return 4 * HOUR;
    case '/predictions':
      return HOUR;
    case '/odds':
      return 3 * HOUR;
    case '/odds/live':
      return 10_000;
    default:
      return 5 * MIN;
  }
}
