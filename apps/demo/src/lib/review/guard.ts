/**
 * Sessão de admin nas rotas de API da revisão. O proxy já barra quem não é admin em `/api/ajustes/*`;
 * a rota confere de novo, junto do dado (o mesmo cuidado de `lib/auth/admin.ts`).
 */
import { auth } from '@/lib/auth/server';

export type ReviewActor = { id: string; email: string };

export async function requireAdminApi(request: Request): Promise<ReviewActor | Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ code: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return Response.json({ code: 'forbidden' }, { status: 403 });
  return { id: session.user.id, email: session.user.email };
}
