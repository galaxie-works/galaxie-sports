/**
 * Repassa à API o vídeo relacionado que o player oficial recusou (onError 100/101/150), com a chave de
 * demonstração do servidor: o vídeo sai da vitrine em todos os jogos. Só o item e o código passam.
 */
import { API_URL, apiHeaders } from '@/lib/galaxie/server';

const CODES = new Set([100, 101, 150]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { item_id?: unknown; code?: unknown } | null;
  const itemId = typeof body?.item_id === 'string' ? body.item_id : '';
  const code = typeof body?.code === 'number' ? body.code : NaN;
  if (!UUID.test(itemId) || !CODES.has(code)) return new Response(null, { status: 400 });
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
