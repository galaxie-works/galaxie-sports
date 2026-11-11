'use client';

/**
 * `getFanToken` dos widgets na demo (#1020): pede o token `gft_` da pessoa logada à própria demo. Sem perfil de
 * torcedor (409) ou sem sessão, devolve null e o widget mostra "entre para participar".
 */
export async function getDemoFanToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl('/api/torcedor/token', { method: 'POST', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === 'string' && body.token.startsWith('gft_') ? body.token : null;
  } catch {
    return null;
  }
}
