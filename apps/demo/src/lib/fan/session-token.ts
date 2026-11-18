/**
 * Token do torcedor que o proxy da demo usa nas rotas do torcedor (#1369): sai da sessão, no servidor, e não do
 * header que o navegador manda. Assim o proxy só fala em nome de quem está logado, e o teto por sessão vale por
 * pessoa. O token fica guardado por pessoa e perfil até perto de vencer (a demo roda num processo só).
 */
import { auth, isAccessExpired } from '@/lib/auth/server';

import { demoFanTokenBody, storedFanProfile } from './profile';
import { issueDemoFanToken } from './token';

/** Renova este tanto antes de vencer, para o pedido não chegar à API com o token expirado. */
const RENEW_BEFORE_MS = 60_000;
/** Teto de pessoas guardadas; passou, o mais antigo sai. */
const MAX_CACHED = 5_000;

interface Cached {
  key: string;
  token: string;
  expiresAt: number;
}

const cache = new Map<string, Cached>();

export type SessionFanToken = { ok: true; authorization: string } | { ok: false; status: 401 | 502 | 503 };

export async function sessionFanAuthorization(
  request: Request,
  now: () => number = Date.now,
): Promise<SessionFanToken> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || isAccessExpired(session.user)) return { ok: false, status: 401 };
  const profile = storedFanProfile(session.user as Parameters<typeof storedFanProfile>[0]);
  // sem perfil de torcedor não há token: o widget pede o perfil, como no `/api/fan/token`
  if (!profile) return { ok: false, status: 401 };
  const userId = session.user.id;
  const locale = session.user.locale;
  // o perfil e o idioma vão dentro do token: mudou o apelido, sai outro
  const key = JSON.stringify(demoFanTokenBody(userId, profile, locale));
  const hit = cache.get(userId);
  if (hit && hit.key === key && hit.expiresAt - RENEW_BEFORE_MS > now()) {
    return { ok: true, authorization: `Bearer ${hit.token}` };
  }
  try {
    const issued = await issueDemoFanToken(userId, profile, locale);
    const expiresAt = Date.parse(issued.expiresAt);
    cache.delete(userId);
    if (Number.isFinite(expiresAt)) {
      cache.set(userId, { key, token: issued.token, expiresAt });
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    }
    return { ok: true, authorization: `Bearer ${issued.token}` };
  } catch (err) {
    const status = (err as { status?: number }).status;
    // apelido recusado ou perfil inválido: a pessoa resolve no "Perfil de torcedor" (o widget pede de novo)
    if (status === 400 || status === 401 || status === 403) return { ok: false, status: 401 };
    return { ok: false, status: status === 503 ? 503 : 502 };
  }
}

/** Só para os testes. */
export function clearSessionFanTokens() {
  cache.clear();
}
