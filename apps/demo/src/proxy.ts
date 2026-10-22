/**
 * Porta de entrada da demo: toda página e toda leitura da API exigem sessão válida, com acesso dentro
 * do prazo; a área /ajustes exige admin. Roda em Node (Next 16), então valida a sessão no banco antes de
 * qualquer conteúdo renderizar.
 *
 * Também escolhe o idioma: cookie `galaxie-idioma` ou, no primeiro acesso, o `Accept-Language`. As
 * páginas vivem em `app/[locale]/...`; o proxy reescreve `/times/1` para `/<idioma>/times/1` sem mudar a
 * URL visível (links, trilha e "voltar" do login continuam sem prefixo).
 */
import { type NextRequest, NextResponse } from 'next/server';

import { auth, isAccessExpired } from '@/lib/auth/server';
import { COOKIE_MAX_AGE, LOCALE_COOKIE, isLocale, resolveLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';

/** Rotas públicas: login e a API do próprio auth. */
const PUBLIC_PREFIXES = ['/login', '/api/auth'];

/**
 * Telas do antigo login por senha. Links de convite e de redefinição já enviados por e-mail caem no
 * login (sem repassar o token da URL antiga, que não vale mais nada).
 */
const LEGACY_PASSWORD_PAGES = ['/definir-senha', '/esqueci-senha'];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Páginas passam pelo segmento de idioma; API, arquivos e rotas internas do Next, não. */
const isPage = (pathname: string) =>
  !pathname.startsWith('/api/') && !pathname.startsWith('/_next') && !/\.\w+$/.test(pathname);

const localeOf = (request: NextRequest) =>
  resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value, request.headers.get('accept-language'));

/** Segue para a página no idioma da pessoa (e grava o cookie no primeiro acesso). */
function render(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isPage(pathname)) return NextResponse.next();
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = localeOf(request);
  const url = new URL(`/${locale}${pathname === '/' ? '' : pathname}${search}`, request.url);
  const response = NextResponse.rewrite(url);
  if (!isLocale(cookie)) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: COOKIE_MAX_AGE, sameSite: 'lax' });
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (matches(pathname, LEGACY_PASSWORD_PAGES)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (matches(pathname, PUBLIC_PREFIXES)) return render(request);

  const session = await auth.api.getSession({ headers: request.headers });
  const isApi = pathname.startsWith('/api/');
  const t = isApi ? getDictionary(localeOf(request)).common : null;
  const deny = (motivo?: string) => {
    if (isApi) return NextResponse.json({ title: t!.unauthorized }, { status: 401 });
    const url = new URL('/login', request.url);
    if (motivo) url.searchParams.set('motivo', motivo);
    else if (pathname !== '/') url.searchParams.set('voltar', `${pathname}${search}`);
    return NextResponse.redirect(url);
  };

  if (!session) return deny();
  if (isAccessExpired(session.user)) return deny('expirado');
  if (pathname.startsWith('/ajustes') && session.user.role !== 'admin') {
    return isApi
      ? NextResponse.json({ title: t!.forbidden }, { status: 403 })
      : NextResponse.redirect(new URL('/', request.url));
  }
  return render(request);
}

export const config = {
  // Tudo, menos arquivos estáticos do Next, a marca e o favicon.
  matcher: ['/((?!_next/static|_next/image|brand/|favicon.ico).*)'],
};
