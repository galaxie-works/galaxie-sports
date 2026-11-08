/**
 * Segredos derivados do "Sugerir ou reportar algo" (só no servidor, puro com o segredo passado):
 *
 * - referências opacas de quem enviou: `u_<12 hex>` para o usuário e `t_<12 hex>` para o tenant, HMAC-SHA256 do id.
 *   Estáveis (o mesmo usuário tem sempre a mesma referência, então dá para agrupar issues), mas não revertem para o
 *   e-mail ou o nome do tenant sem o segredo; quem tem o segredo confere com `feedbackRef`;
 * - link assinado dos anexos: `/api/feedback/anexo/<aaaa-mm>/<uuid>.<ext>?e=<expira>&s=<assinatura>`. O arquivo fica
 *   no bucket privado; a rota só entrega com assinatura válida e dentro do prazo.
 *
 * O segredo de base é o BETTER_AUTH_SECRET (quem o tem já forjaria uma sessão), separado por finalidade.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prazo do link de anexo: a issue continua mostrando a imagem por um ano. */
export const FEEDBACK_LINK_TTL_S = 365 * 24 * 60 * 60;

/** Chave no bucket: só o formato que a ação grava (sem `..`, sem barra extra). */
export const FEEDBACK_KEY_RE = /^\d{4}-\d{2}\/[0-9a-f-]{36}\.(png|jpg)$/;

const derive = (secret: string, purpose: string) =>
  createHmac('sha256', secret).update(`feedback:${purpose}`).digest();

/** Referência opaca e estável de um id (`kind` u = usuário, t = tenant). */
export function feedbackRef(secret: string, kind: 'u' | 't', id: string): string {
  const mac = createHmac('sha256', derive(secret, `ref:${kind}`))
    .update(id)
    .digest('hex');
  return `${kind}_${mac.slice(0, 12)}`;
}

const linkMac = (secret: string, key: string, expires: number) =>
  createHmac('sha256', derive(secret, 'link')).update(`${key}\n${expires}`).digest('base64url');

/** Caminho assinado do anexo (sem o domínio). */
export function signAttachmentPath(secret: string, key: string, nowS: number): string {
  const expires = nowS + FEEDBACK_LINK_TTL_S;
  return `/api/feedback/anexo/${key}?e=${expires}&s=${linkMac(secret, key, expires)}`;
}

/** Assinatura válida e dentro do prazo? */
export function verifyAttachmentLink(
  secret: string,
  key: string,
  expires: string | null,
  sig: string | null,
  nowS: number,
): boolean {
  if (!FEEDBACK_KEY_RE.test(key) || !expires || !sig || !/^\d{1,12}$/.test(expires)) return false;
  const exp = Number(expires);
  if (exp < nowS) return false;
  const want = Buffer.from(linkMac(secret, key, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
