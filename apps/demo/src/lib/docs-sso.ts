/**
 * Login das docs (galaxie-sports-docs, épico #1483, issue #1484): o site de docs não tem login próprio. Quem chega lá
 * sem sessão é mandado para `/docs-handoff` aqui; o proxy exige a sessão do Better Auth (manda ao login se faltar) e a
 * rota devolve o usuário às docs com um passe curto assinado com `DOCS_SSO_SECRET` (o mesmo segredo nos dois lados).
 * As docs conferem o passe e abrem a sessão delas. Sem tabela nova e sem depender de domínio compartilhado.
 *
 * Formato do passe: `base64url(JSON).base64url(HMAC-SHA256)`. Puro, para os testes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { internalPath } from './internal-path';

/** Validade do passe: só o tempo do redirecionamento. */
export const DOCS_PASS_TTL_SEC = 60;
export const DOCS_PASS_AUDIENCE = 'galaxie-docs';

export interface DocsPass {
  /** id do usuário no Better Auth */
  sub: string;
  role: string;
  aud: typeof DOCS_PASS_AUDIENCE;
  /** segundos unix */
  exp: number;
}

const b64 = (s: Buffer | string) => Buffer.from(s).toString('base64url');
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function signDocsPass(
  user: { id: string; role?: string | null },
  secret: string,
  now = Date.now(),
): string {
  const pass: DocsPass = {
    sub: user.id,
    role: user.role ?? 'user',
    aud: DOCS_PASS_AUDIENCE,
    exp: Math.floor(now / 1000) + DOCS_PASS_TTL_SEC,
  };
  const body = b64(JSON.stringify(pass));
  return `${body}.${sign(body, secret)}`;
}

export function verifyDocsPass(token: string, secret: string, now = Date.now()): DocsPass | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const pass = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DocsPass;
    if (pass.aud !== DOCS_PASS_AUDIENCE || typeof pass.sub !== 'string' || pass.exp * 1000 < now) return null;
    return pass;
  } catch {
    return null;
  }
}

/**
 * Só caminhos do próprio site de docs voltam no `return`, resolvidos como o navegador resolveria
 * (`internalPath`): tab, quebra de linha, `\` e `//` que levariam a outro domínio viram `/`.
 */
export function safeDocsReturn(raw: string | null): string {
  return internalPath(raw) ?? '/';
}

/** Base do site de docs (`DOCS_URL`, padrão https://docs.galaxiesports.com). */
export function docsBaseUrl(
  env: { DOCS_URL?: string; DOCS_DOMAIN?: string } = {
    DOCS_URL: process.env.DOCS_URL,
    DOCS_DOMAIN: process.env.DOCS_DOMAIN,
  },
): string {
  const host =
    env.DOCS_URL || (env.DOCS_DOMAIN ? `https://${env.DOCS_DOMAIN}` : 'https://docs.galaxiesports.com');
  return host.replace(/\/+$/, '');
}
