/**
 * `POST /api/torcedor/token`: o token `gft_` da pessoa logada, para os widgets da demo (`getFanToken`). Só da
 * própria demo (mesma origem), com sessão e o perfil de torcedor preenchido; nunca em cache.
 */
import { auth, isAccessExpired } from '@/lib/auth/server';
import { storedFanProfile } from '@/lib/fan/profile';
import { DemoFanTokenError, isSameOrigin, issueDemoFanToken } from '@/lib/fan/token';

const NO_STORE = { 'cache-control': 'no-store' };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ code: 'forbidden' }, { status: 403, headers: NO_STORE });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || isAccessExpired(session.user))
    return Response.json({ code: 'session' }, { status: 401, headers: NO_STORE });
  const profile = storedFanProfile(session.user as Parameters<typeof storedFanProfile>[0]);
  // sem perfil de torcedor não há token: o widget mostra "entre para participar" e a demo pede o perfil
  if (!profile) return Response.json({ code: 'fan_profile_missing' }, { status: 409, headers: NO_STORE });
  try {
    const token = await issueDemoFanToken(session.user.id, profile, session.user.locale);
    return Response.json({ token: token.token, expires_at: token.expiresAt }, { headers: NO_STORE });
  } catch (err) {
    // apelido que as listas da moderação passaram a recusar: a pessoa troca no "Perfil de torcedor"
    if (err instanceof DemoFanTokenError && err.status === 400 && err.paths.includes('nickname'))
      return Response.json({ code: 'fan_nickname_rejected' }, { status: 409, headers: NO_STORE });
    console.error('[torcedor] token não emitido', err);
    const status = err instanceof DemoFanTokenError && err.status === 503 ? 503 : 502;
    return Response.json({ code: 'unavailable' }, { status, headers: NO_STORE });
  }
}
