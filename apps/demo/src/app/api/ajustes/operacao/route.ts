/**
 * Estado do painel de Operação em JSON (admin). Mesmo conteúdo da página: flags com valor efetivo e
 * origem, credenciais só como configurada/não configurada, jobs, cota, gasto de IA e histórico. O
 * smoke test do deploy confere esta rota com a assinatura de `lib/ops/smoke.ts`.
 */
import { auth } from '@/lib/auth/server';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { OpsUnavailableError, readOpsSnapshot } from '@/lib/ops/data';
import { SMOKE_HEADER, verifySmokeSignature } from '@/lib/ops/smoke';

export async function GET(request: Request) {
  const now = new Date();
  const smoke = verifySmokeSignature(
    request.headers.get(SMOKE_HEADER),
    process.env.BETTER_AUTH_SECRET,
    now.getTime(),
  );
  if (!smoke) {
    const session = await auth.api.getSession({ headers: request.headers });
    const t = getDictionary(await getRequestLocale()).common;
    if (!session) return Response.json({ title: t.unauthorized }, { status: 401 });
    if (session.user.role !== 'admin') return Response.json({ title: t.forbidden }, { status: 403 });
  }
  try {
    const data = await readOpsSnapshot(now);
    return Response.json({ data }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof OpsUnavailableError)
      return Response.json({ title: 'ops tables missing' }, { status: 503 });
    throw err;
  }
}
