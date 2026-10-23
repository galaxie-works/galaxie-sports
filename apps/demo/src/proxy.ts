/**
 * Porta de entrada da demo: toda página e toda leitura da API exigem sessão válida, com acesso dentro
 * do prazo; a área /ajustes (e /api/ajustes) exige admin e o painel do cliente (/cliente e /api/cliente)
 * exige o papel `client` ou admin (`lib/auth/roles.ts`). As exceções (login, apresentação, termos,
 * privacidade, robots.txt, sitemap e o registry dos widgets) estão em `lib/public-routes.ts`; sem sessão, a raiz mostra a
 * apresentação em vez de redirecionar para o login. Roda em Node (Next 16), então valida a sessão no banco antes de
 * qualquer conteúdo renderizar.
 *
 * Também escolhe o idioma: cookie `galaxie-idioma` ou, no primeiro acesso, o `Accept-Language`. As
 * páginas vivem em `app/[locale]/...`; o proxy reescreve `/times/1` para `/<idioma>/times/1` sem mudar a
 * URL visível (links, trilha e "voltar" do login continuam sem prefixo).
 */
import { type NextRequest, NextResponse } from 'next/server';

import { matchesPrefix, routeAccess } from '@/lib/auth/roles';
import { auth, isAccessExpired } from '@/lib/auth/server';
import { COOKIE_MAX_AGE, LOCALE_COOKIE, isLocale, resolveLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { SMOKE_HEADER } from '@/lib/ops/smoke';
import { LANDING_PAGE, isPublicPath } from '@/lib/public-routes';

/**
 * Rota que o smoke test do deploy lê sem sessão, assinando com o segredo do próprio contêiner. O proxy só
 * deixa passar; quem confere a assinatura é a rota (lib/ops/smoke.ts), e sem ela responde 401.
 */
const SMOKE_ROUTE = '/api/ajustes/operacao';

/**
 * Telas do antigo login por senha. Links de convite e de redefinição já enviados por e-mail caem no
 * login (sem repassar o token da URL antiga, que não vale mais nada).
 */
const LEGACY_PASSWORD_PAGES = ['/definir-senha', '/esqueci-senha'];

/** Páginas passam pelo segmento de idioma; API, arquivos e rotas internas do Next, não. */
const isPage = (pathname: string) =>
  !pathname.startsWith('/api/') && !pathname.startsWith('/_next') && !/\.\w+$/.test(pathname);

const localeOf = (request: NextRequest) =>
  resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value, request.headers.get('accept-language'));

/**
 * Segue para a página no idioma da pessoa (e grava o cookie no primeiro acesso). `page` troca a página
 * mostrada sem mudar a URL (a raiz sem sessão mostra a apresentação).
 */
function render(request: NextRequest, pathname = request.nextUrl.pathname) {
  const { search } = request.nextUrl;
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
  if (matchesPrefix(pathname, LEGACY_PASSWORD_PAGES)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (isPublicPath(pathname)) return render(request);

  if (pathname === SMOKE_ROUTE && request.headers.has(SMOKE_HEADER)) return NextResponse.next();

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

  if (!session) return pathname === '/' ? render(request, LANDING_PAGE) : deny();
  if (isAccessExpired(session.user)) return deny('expirado');
  if (routeAccess(pathname, session.user.role) === 'deny') {
    return isApi
      ? NextResponse.json({ title: t!.forbidden }, { status: 403 })
      : NextResponse.redirect(new URL('/', request.url));
  }
  return render(request);
}

export const config = {
  // Tudo, menos arquivos estáticos do Next, a marca, as bandeiras e os escudos da apresentação e o favicon.
  matcher: ['/((?!_next/static|_next/image|brand/|flags/|crests/|favicon.ico).*)'],
};
