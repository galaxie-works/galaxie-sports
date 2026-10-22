/**
 * Porta de entrada da demo: toda página e toda leitura da API exigem sessão válida, com acesso dentro
 * do prazo; a área /ajustes exige admin. Roda em Node (Next 16), então valida a sessão no banco antes de
 * qualquer conteúdo renderizar.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { auth, isAccessExpired } from '@/lib/auth/server';

/** Rotas públicas: login e a API do próprio auth. */
const PUBLIC_PREFIXES = ['/login', '/api/auth'];

/**
 * Telas do antigo login por senha. Links de convite e de redefinição já enviados por e-mail caem no
 * login (sem repassar o token da URL antiga, que não vale mais nada).
 */
const LEGACY_PASSWORD_PAGES = ['/definir-senha', '/esqueci-senha'];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (matches(pathname, LEGACY_PASSWORD_PAGES)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (matches(pathname, PUBLIC_PREFIXES)) return NextResponse.next();

  const session = await auth.api.getSession({ headers: request.headers });
  const isApi = pathname.startsWith('/api/');
  const deny = (motivo?: string) => {
    if (isApi) return NextResponse.json({ title: 'Não autenticado' }, { status: 401 });
    const url = new URL('/login', request.url);
    if (motivo) url.searchParams.set('motivo', motivo);
    else if (pathname !== '/') url.searchParams.set('voltar', `${pathname}${search}`);
    return NextResponse.redirect(url);
  };

  if (!session) return deny();
  if (isAccessExpired(session.user)) return deny('expirado');
  if (pathname.startsWith('/ajustes') && session.user.role !== 'admin') {
    return isApi
      ? NextResponse.json({ title: 'Sem permissão' }, { status: 403 })
      : NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Tudo, menos arquivos estáticos do Next, a marca e o favicon.
  matcher: ['/((?!_next/static|_next/image|brand/|favicon.ico).*)'],
};
