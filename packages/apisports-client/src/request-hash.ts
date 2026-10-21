import { createHash } from 'node:crypto';

export type Params = Record<string, string | number | undefined>;

/** Parâmetros com chaves ordenadas, sem valores vazios e com valores em string — base do cache/raw. */
export function normalizeParams(params: Params): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Identidade de uma requisição: mesma chamada → mesmo hash, independentemente da ordem dos parâmetros. */
export function requestHash(provider: string, sport: string, endpoint: string, params: Params): string {
  const canonical = JSON.stringify([provider, sport, endpoint, normalizeParams(params)]);
  return createHash('sha256').update(canonical).digest('hex');
}
