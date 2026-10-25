/**
 * Revalidação do cache da demo pelas tags do change feed (POST `{ tags }`). Quem chama é o seguidor do
 * `ops.change_feed` que roda no próprio servidor (lib/cache/follower.ts): o `revalidateTag` só funciona
 * dentro de uma requisição. Sem sessão; exige a assinatura do servidor (lib/cache/signature.ts).
 */
import { revalidateApiTags } from '@/lib/cache/revalidate';
import { REVALIDATE_HEADER, revalidateSecret, verifyRevalidate } from '@/lib/cache/signature';
import { parseTagList } from '@/lib/cache/tags';

const NO_STORE = { 'cache-control': 'no-store' };
const BODY_MAX = 256_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (
    raw.length > BODY_MAX ||
    !verifyRevalidate(request.headers.get(REVALIDATE_HEADER), revalidateSecret(), raw, Date.now())
  )
    return Response.json({ code: 'unauthorized' }, { status: 401, headers: NO_STORE });
  let body: { tags?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = {};
  }
  const tags = parseTagList(body.tags);
  if (!tags) return Response.json({ code: 'invalid_tags' }, { status: 400, headers: NO_STORE });
  return Response.json({ data: { revalidated: revalidateApiTags(tags) } }, { headers: NO_STORE });
}
