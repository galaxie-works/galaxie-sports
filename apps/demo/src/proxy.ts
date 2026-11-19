/**
 * Porta de entrada da demo: toda página e toda leitura da API exigem sessão válida, com acesso dentro
 * do prazo; a área /settings (e /api/settings) exige admin e o painel do cliente (/client e /api/client)
 * exige o papel `client` ou admin (`lib/auth/roles.ts`). As exceções (login, apresentação, termos,
 * privacidade, robots.txt, sitemap, o registry e o embed dos widgets) estão em `lib/public-routes.ts`; sem sessão, a raiz mostra a
 * apresentação em vez de redirecionar para o login. Roda em Node (Next 16), então valida a sessão no banco antes de
 * qualquer conteúdo renderizar.
 *
 * Também escolhe o idioma: cookie `galaxie-idioma` ou, no primeiro acesso, o `Accept-Language`. As
 * páginas vivem em `app/[locale]/...`; o proxy reescreve `/teams/1` para `/<idioma>/teams/1` sem mudar a
 * URL visível (links, trilha e o `next` do login continuam sem prefixo).
 *
 * Antes de tudo, os links antigos (rotas em português de antes do #630 e as páginas que mudaram) recebem o
 * redirecionamento permanente; depois, o papel do processo (`APP_ROLE`, `lib/app-role.ts`): o `site` responde 404 ao
 * portal e ao painel, e o `console` ao público e à demo. Sem a variável (`all`), atende tudo.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { appRole, servesPath } from '@/lib/app-role';
import { accessPathname, matchesPrefix, routeAccess } from '@/lib/auth/roles';
import { REVALIDATE_HEADER, REVALIDATE_ROUTE } from '@/lib/cache/signature';
import { auth, isAccessExpired } from '@/lib/auth/server';
import { COOKIE_MAX_AGE, LOCALE_COOKIE, isLocale, resolveLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { legacyQueryTarget, legacyRedirectStatus, legacyTarget } from '@/lib/legacy-routes';
import { SMOKE_HEADER } from '@/lib/ops/smoke';
import { legacySettingsRedirect } from '@/lib/ops/system-routes';
import { LANDING_PAGE, isPublicPath } from '@/lib/public-routes';
import { legacySportRedirect } from '@/lib/sport-families';

/**
 * Rota que o smoke test do deploy lê sem sessão, assinando com o segredo do próprio contêiner. O proxy só
 * deixa passar; quem confere a assinatura é a rota (lib/ops/smoke.ts), e sem ela responde 401.
 */
const SMOKE_ROUTE = '/api/settings/operations';

/**
 * Telas do antigo login por senha. Links de convite e de redefinição já enviados por e-mail caem no
 * login (sem repassar o token da URL antiga, que não vale mais nada).
 */
const LEGACY_PASSWORD_PAGES = ['/definir-senha', '/esqueci-senha'];

/** Rotas fora de `app/[locale]` que não são API nem arquivo: seguem sem o prefixo de idioma. */
const LOCALELESS_ROUTES = ['/docs-handoff'];

/** Páginas passam pelo segmento de idioma; API, arquivos, rotas internas do Next e as de cima, não. */
const isPage = (pathname: string) =>
  !pathname.startsWith('/api/') &&
  !pathname.startsWith('/_next') &&
  !/\.\w+$/.test(pathname) &&
  !matchesPrefix(pathname, LOCALELESS_ROUTES);

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

/** Rota do outro papel: 404, sem dizer qual serviço a atende (JSON na API, texto nas páginas). */
function notServedHere(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const title = getDictionary(localeOf(request)).common.notFound;
  const headers = { 'cache-control': 'no-store' };
  return pathname.startsWith('/api/')
    ? NextResponse.json({ title }, { status: 404, headers })
    : new NextResponse(title, {
        status: 404,
        headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
      });
}

/**
 * Links antigos, antes do papel do processo: o caminho antigo pode ser de um papel e o novo, do outro, e o Traefik ainda
 * manda os prefixos antigos do console para ele. Tudo num salto só: caminho, slug da família e query em português
 * (`/pt-BR/esportes/futebol?aba=jogos` → `/pt-BR/sports/football?tab=matches`). 301 para GET/HEAD e 308 para o resto,
 * por 12 meses, até 15/11/2027 (lib/legacy-routes.ts). Null quando não há nada antigo no endereço.
 */
function legacyRedirect(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  const page = isPage(pathname);
  // esporte por API do fornecedor (`/sports/nba`, `/pt-BR/esportes/formula-1`) → página da família
  const sport = legacySportRedirect(pathname);
  // páginas de Ajustes que se dividiram (#1069): `/ajustes/operacao`, `/ajustes/sistema?aba=…` → item novo
  const settings = !sport && page ? legacySettingsRedirect(pathname, searchParams) : null;
  let url: URL;
  if (sport || settings) {
    url = new URL((sport ?? settings)!, request.url);
    if (sport) url.search = searchParams.toString();
    const query = legacyQueryTarget(url.searchParams);
    if (query) url.search = query.toString();
  } else {
    // rotas, slugs de família e parâmetros em português de antes do #630 (`/times/1?temporada=2025` → `/teams/1?season=2025`)
    const target = legacyTarget(pathname, searchParams, page);
    if (!target) return null;
    url = new URL(target, request.url);
  }
  return NextResponse.redirect(url, legacyRedirectStatus(request.method));
}
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const legacy = legacyRedirect(request);
  if (legacy) return legacy;
  if (!servesPath(appRole(), pathname)) return notServedHere(request);
  if (matchesPrefix(pathname, LEGACY_PASSWORD_PAGES)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  // Público só se o caminho continuar público depois de normalizado (`/login/..%2Fsettings` não é login).
  const access = accessPathname(pathname);
  if (isPublicPath(pathname) && access !== null && isPublicPath(access)) return render(request);

  if (pathname === SMOKE_ROUTE && request.headers.has(SMOKE_HEADER)) return NextResponse.next();
  // revalidação do cache pelo seguidor do change feed (o próprio servidor): a rota confere a assinatura
  if (pathname === REVALIDATE_ROUTE && request.headers.has(REVALIDATE_HEADER)) return NextResponse.next();

  const session = await auth.api.getSession({ headers: request.headers });
  const isApi = pathname.startsWith('/api/');
  const t = isApi ? getDictionary(localeOf(request)).common : null;
  const deny = (reason?: string) => {
    if (isApi) return NextResponse.json({ title: t!.unauthorized }, { status: 401 });
    const url = new URL('/login', request.url);
    if (reason) url.searchParams.set('reason', reason);
    else if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  };

  if (!session) return pathname === '/' ? render(request, LANDING_PAGE) : deny();
  if (isAccessExpired(session.user)) return deny('expired');
  if (routeAccess(pathname, session.user.role) === 'deny') {
    return isApi
      ? NextResponse.json({ title: t!.forbidden }, { status: 403 })
      : NextResponse.redirect(new URL('/', request.url));
  }
  return render(request);
}

export const config = {
  // Tudo, menos arquivos estáticos do Next, a marca, as imagens da apresentação (bandeiras, escudos e
  // capturas do app) e o favicon.
  matcher: ['/((?!_next/static|_next/image|brand/|flags/|crests/|showcase/|favicon.ico).*)'],
};
