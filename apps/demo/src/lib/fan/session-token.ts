/**
 * Token do torcedor que o proxy da demo usa nas rotas do torcedor (#1369): sai da sessão, no servidor, e não do
 * header que o navegador manda. Assim o proxy só fala em nome de quem está logado, e o teto por sessão vale por
 * pessoa. O token fica guardado por pessoa e perfil até perto de vencer (a demo roda num processo só); se a API
 * recusar o token guardado (perfil apagado, token revogado), o proxy o descarta e o próximo pedido emite outro.
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
/** Emissão em andamento por pessoa e perfil: pedidos simultâneos esperam a mesma, sem emitir em dobro. */
const inFlight = new Map<string, Promise<SessionFanToken>>();

export type SessionFanToken =
  { ok: true; authorization: string; userId: string } | { ok: false; status: 401 | 502 | 503 };

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
    return { ok: true, authorization: `Bearer ${hit.token}`, userId };
  }
  const flightKey = `${userId}\n${key}`;
  const pending = inFlight.get(flightKey);
  if (pending) return pending;
  const issuing = (async (): Promise<SessionFanToken> => {
    try {
      const issued = await issueDemoFanToken(userId, profile, locale);
      const expiresAt = Date.parse(issued.expiresAt);
      cache.delete(userId);
      if (Number.isFinite(expiresAt)) {
        cache.set(userId, { key, token: issued.token, expiresAt });
        if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
      }
      return { ok: true, authorization: `Bearer ${issued.token}`, userId };
    } catch (err) {
      const status = (err as { status?: number }).status;
      // apelido recusado ou perfil inválido: a pessoa resolve no "Perfil de torcedor" (o widget pede de novo)
      if (status === 400) return { ok: false, status: 401 };
      // 401/403 da emissão é a chave da demo (errada ou revogada), não a pessoa: "indisponível"
      console.error('[torcedor] token da sessão não emitido', err);
      return { ok: false, status: status === 503 ? 503 : 502 };
    } finally {
      inFlight.delete(flightKey);
    }
  })();
  inFlight.set(flightKey, issuing);
  return issuing;
}

/** A API recusou o token guardado: sai do cache (só se ainda for o mesmo), e o próximo pedido emite outro. */
export function dropSessionFanToken(userId: string, authorization: string) {
  const hit = cache.get(userId);
  if (hit && `Bearer ${hit.token}` === authorization) cache.delete(userId);
}

/** Só para os testes. */
export function clearSessionFanTokens() {
  cache.clear();
  inFlight.clear();
}
