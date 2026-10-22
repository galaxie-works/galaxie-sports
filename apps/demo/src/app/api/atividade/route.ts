/** Registra a página vista pelo usuário logado (aba Atividade do painel). */
import { pool } from '@/lib/auth/db';
import { auth } from '@/lib/auth/server';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as { path?: unknown; title?: unknown } | null;
  const path = typeof body?.path === 'string' ? body.path.slice(0, 300) : null;
  if (!path?.startsWith('/') || path.startsWith('/ajustes')) return new Response(null, { status: 204 });
  const title =
    typeof body?.title === 'string' ? body.title.replace(/ · Galaxie Sports$/, '').slice(0, 200) : null;
  await pool.query(`insert into activity (user_id, kind, path, title) values ($1, 'page', $2, $3)`, [
    session.user.id,
    path,
    title,
  ]);
  return new Response(null, { status: 204 });
}
