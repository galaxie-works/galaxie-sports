/**
 * Ponte do login para o site de docs (#1484). O proxy só deixa chegar aqui com sessão válida (sem sessão, manda ao
 * `/login?next=/docs-handoff?...` e volta depois do código). A rota assina um passe de 60 s e devolve o usuário ao
 * `/auth/callback` das docs, que abre a sessão delas e segue para o caminho pedido.
 */
import { headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth/server';
import { docsBaseUrl, safeDocsReturn, signDocsPass } from '@/lib/docs-sso';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.DOCS_SSO_SECRET;
  if (!secret) return new NextResponse('Docs login is not configured', { status: 503 });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  const target = new URL('/auth/callback', docsBaseUrl());
  target.searchParams.set('pass', signDocsPass(session.user, secret));
  target.searchParams.set('return', safeDocsReturn(request.nextUrl.searchParams.get('return')));
  const res = NextResponse.redirect(target);
  res.headers.set('cache-control', 'no-store');
  res.headers.set('referrer-policy', 'no-referrer');
  return res;
}
