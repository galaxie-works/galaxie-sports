/**
 * Repassa à API o vídeo relacionado que o player oficial recusou (onError 100/101/150), com a chave de
 * demonstração do servidor. Na API o aviso tira o vídeo na hora só da vitrine da demo (todos os usuários
 * dela são um tenant); a vitrine dos outros tenants só muda quando outro tenant também relata. Aqui cada
 * aviso fica no log com quem o fez, e cada usuário tem um teto de avisos (`limiter.ts`), para uma sessão
 * só (um convidado, por exemplo) não esvaziar a vitrine da demo. Só o item e o código vão para a API.
 */
import { auth } from '@/lib/auth/server';
import { API_URL, apiHeaders } from '@/lib/galaxie/server';

import { PlaybackReportLimiter } from './limiter';

const CODES = new Set([100, 101, 150]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const limiter = new PlaybackReportLimiter();

export async function POST(request: Request) {
  // o proxy já exige sessão; aqui ela identifica quem avisou
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as { item_id?: unknown; code?: unknown } | null;
  const itemId = typeof body?.item_id === 'string' ? body.item_id : '';
  const code = typeof body?.code === 'number' ? body.code : NaN;
  if (!UUID.test(itemId) || !CODES.has(code)) return new Response(null, { status: 400 });
  const verdict = limiter.take(session.user.id, itemId);
  const who = { user: session.user.id, role: session.user.role ?? null, itemId, code, verdict };
  console.info('[demo] vídeo relacionado recusado pelo player', JSON.stringify(who));
  // o mesmo item de novo não muda nada na API: responde como aceito sem repassar
  if (verdict === 'duplicate') return new Response(null, { status: 204 });
  if (verdict === 'limited') return new Response(null, { status: 429 });
  try {
    const upstream = await fetch(`${API_URL}/v1/related/playback-errors`, {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ item_id: itemId, code }),
      cache: 'no-store',
    });
    return new Response(null, { status: upstream.ok ? 204 : upstream.status });
  } catch {
    return new Response(null, { status: 502 });
  }
}
