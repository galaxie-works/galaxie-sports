/**
 * Token do torcedor da demo (#1020): a demo faz o papel do servidor do cliente e pede o `gft_` à API com a
 * chave do tenant da demo (`GALAXIE_DEMO_KEY`, só no servidor).
 */
import { API_URL, apiHeaders } from '@/lib/galaxie/server';

import { demoFanTokenBody, type FanProfile } from './profile';

export interface DemoFanToken {
  token: string;
  expiresAt: string;
}

export class DemoFanTokenError extends Error {
  constructor(readonly status: number) {
    super(`a API recusou o token do torcedor (${status})`);
    this.name = 'DemoFanTokenError';
  }
}

export async function issueDemoFanToken(
  userId: string,
  profile: FanProfile,
  locale: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoFanToken> {
  const res = await fetchImpl(`${API_URL}/v1/fans/tokens`, {
    method: 'POST',
    headers: apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(demoFanTokenBody(userId, profile, locale)),
    cache: 'no-store',
  });
  if (!res.ok) throw new DemoFanTokenError(res.status);
  const body = (await res.json()) as { data?: { token?: unknown; expires_at?: unknown } };
  const token = body.data?.token;
  const expiresAt = body.data?.expires_at;
  if (typeof token !== 'string' || !token.startsWith('gft_') || typeof expiresAt !== 'string')
    throw new DemoFanTokenError(502);
  return { token, expiresAt };
}

/** Pedido de outra página (CSRF): o navegador marca `Sec-Fetch-Site`; sem ele, confere o `Origin`. */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
