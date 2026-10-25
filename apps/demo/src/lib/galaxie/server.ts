/**
 * Cliente da API Galaxie Sports para uso no servidor (Server Components e Route Handlers).
 * A chave do tenant de demonstração fica só no servidor: o navegador fala com `/api/galaxie/*`.
 */
import { tagFromResponse } from './cache-tags';

export const API_URL = (
  process.env.GALAXIE_API_URL ??
  process.env.NEXT_PUBLIC_GALAXIE_API_URL ??
  'http://localhost:8080'
).replace(/\/+$/, '');

export class GalaxieApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { title?: string; detail?: string; type?: string } | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Galaxie API respondeu ${status}`);
    this.name = 'GalaxieApiError';
  }
}

export function apiHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const key = process.env.GALAXIE_DEMO_KEY;
  if (key) headers.set('x-galaxie-key', key);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  return headers;
}

/** GET tipado na API (`path` começa em `/v1/...`). */
export async function galaxieGet<T>(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(`${API_URL}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { ...init, headers: apiHeaders(init?.headers) });
  // dentro de 'use cache', a entrada leva as tags da resposta (purgadas pelo change feed)
  tagFromResponse(res);
  if (!res.ok) {
    const problem = await res.json().catch(() => null);
    throw new GalaxieApiError(res.status, problem);
  }
  return (await res.json()) as T;
}
