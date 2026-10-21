/**
 * TTLs por tipo de recurso, em segundos (docs/05 §7). Valem para o cache do Valkey,
 * para o `s-maxage` (CDN) e, limitados por `CLIENT_MAX_AGE_SEC`, para o `max-age` do cliente.
 */
export const CACHE_TTL = {
  /** Países, competições, times, venues. */
  catalog: 24 * 3600,
  /** Elencos e tabelas. */
  standings: 3600,
  /** Agenda do dia. */
  schedule: 5 * 60,
  /** Evento ao vivo. */
  live: 10,
  /** Onde assistir — correção propagada em ≤ 5 min via purge. */
  whereToWatch: 60,
  semantic: 24 * 3600,
} as const;

export type CacheResource = keyof typeof CACHE_TTL;

/** O navegador revalida em no máximo 5 min (ETag/304); a CDN segue o TTL cheio e é purgada ativamente. */
export const CLIENT_MAX_AGE_SEC = 300;

export function cacheControl(ttlSec: number): string {
  if (ttlSec <= 0) return 'no-cache';
  const maxAge = Math.min(ttlSec, CLIENT_MAX_AGE_SEC);
  return `public, max-age=${maxAge}, s-maxage=${ttlSec}, stale-while-revalidate=${Math.min(ttlSec, 60)}`;
}
