/** Registra a página vista pelo usuário logado (aba Atividade do painel). */
import { pool } from '@/lib/auth/db';
import { auth } from '@/lib/auth/server';
import { internalPath } from '@/lib/internal-path';
import { rejectCrossSite } from '@/lib/security/same-origin';

/**
 * Registros por usuário por minuto. O app manda um por página aberta (1,5 s depois de abrir), então
 * passar disso é script, não navegação: o excedente é descartado em silêncio.
 */
const ACTIVITY_PER_MINUTE = 60;

const MAX_PATH = 300;

/**
 * Caminho mandado pelo navegador, que vira link no painel do admin: só caminho da própria demo
 * (`//evil.com/x` ou `/\evil.com` levariam para fora).
 */
const pathOf = (value: unknown) => internalPath(value)?.slice(0, MAX_PATH) ?? null;

export async function POST(request: Request) {
  // CSRF: só a própria demo, com corpo JSON (lib/security/same-origin.ts)
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    title?: unknown;
    from?: unknown;
    depth?: unknown;
  } | null;
  const path = pathOf(body?.path);
  if (!path || path === '/ajustes' || path.startsWith('/ajustes/')) {
    return new Response(null, { status: 204 });
  }
  const title =
    typeof body?.title === 'string' ? body.title.replace(/ · Galaxie Sports$/, '').slice(0, 200) : null;
  // Trilha de navegação: item anterior (de onde veio) e profundidade (1 = início da trilha).
  const from = pathOf(body?.from);
  const depth =
    typeof body?.depth === 'number' && Number.isInteger(body.depth) && body.depth > 0 && body.depth < 10_000
      ? body.depth
      : null;
  await pool.query(
    `insert into activity (user_id, kind, path, title, from_path, trail_depth)
     select $1, 'page', $2, $3, $4, $5
      where (select count(*) from activity
              where user_id = $1 and created_at > now() - interval '1 minute') < $6`,
    [session.user.id, path, title, from, depth, ACTIVITY_PER_MINUTE],
  );
  return new Response(null, { status: 204 });
}
