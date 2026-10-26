/**
 * Repassa à API o vídeo relacionado que o player oficial recusou (onError 100/101/150), com a chave de
 * demonstração do servidor: o vídeo sai da vitrine em todos os jogos, para todos (a recusa de embed é do
 * vídeo), e o agente deixa de gastar cota com ele. Como qualquer sessão da demo (convidados inclusive) pode
 * avisar, cada aviso fica no log com quem o fez e cada usuário tem um teto de avisos (`limiter.ts`); o
 * painel (Ajustes → Vídeos relacionados) desfaz um bloqueio indevido. Só o item e o código vão para a API.
 */
import { revalidateTag } from 'next/cache';

import { auth } from '@/lib/auth/server';
import { RELATED_CACHE_TAG } from '@/lib/galaxie/related-cache';
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
  const at = Date.now();
  const verdict = limiter.take(session.user.id, itemId, at);
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
    // 5xx: a API não registrou; o próximo aviso do mesmo item tenta de novo
    if (upstream.status >= 500) limiter.release(session.user.id, itemId, at);
    // a vitrine da demo (getRelated, `use cache`) relê a API, que já tirou o vídeo
    if (upstream.ok) revalidateTag(RELATED_CACHE_TAG, { expire: 0 });
    return new Response(null, { status: upstream.ok ? 204 : upstream.status });
  } catch {
    limiter.release(session.user.id, itemId, at);
    return new Response(null, { status: 502 });
  }
}
