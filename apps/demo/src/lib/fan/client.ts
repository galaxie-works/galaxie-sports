'use client';

/**
 * `getFanToken` dos widgets na demo (#1020): pede o token `gft_` da pessoa logada à própria demo. Sem perfil de
 * torcedor (409) ou sem sessão, devolve null e o widget mostra "entre para participar".
 */
/** Evento da janela que abre o "Perfil de torcedor" do menu do usuário (o "Entrar" dos widgets do torcedor). */
export const OPEN_FAN_PROFILE_EVENT = 'galaxie-demo:open-fan-profile';

export async function getDemoFanToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl('/api/fan/token', { method: 'POST', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === 'string' && body.token.startsWith('gft_') ? body.token : null;
  } catch {
    return null;
  }
}
