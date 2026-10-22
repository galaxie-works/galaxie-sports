/** Registra a página vista pelo usuário logado (aba Atividade do painel). */
import { pool } from '@/lib/auth/db';
import { auth } from '@/lib/auth/server';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    title?: unknown;
    from?: unknown;
    depth?: unknown;
  } | null;
  const path = typeof body?.path === 'string' ? body.path.slice(0, 300) : null;
  if (!path?.startsWith('/') || path.startsWith('/ajustes')) return new Response(null, { status: 204 });
  const title =
    typeof body?.title === 'string' ? body.title.replace(/ · Galaxie Sports$/, '').slice(0, 200) : null;
  // Trilha de navegação: item anterior (de onde veio) e profundidade (1 = início da trilha).
  const from = typeof body?.from === 'string' && body.from.startsWith('/') ? body.from.slice(0, 300) : null;
  const depth =
    typeof body?.depth === 'number' && Number.isInteger(body.depth) && body.depth > 0 && body.depth < 10_000
      ? body.depth
      : null;
  await pool.query(
    `insert into activity (user_id, kind, path, title, from_path, trail_depth) values ($1, 'page', $2, $3, $4, $5)`,
    [session.user.id, path, title, from, depth],
  );
  return new Response(null, { status: 204 });
}
