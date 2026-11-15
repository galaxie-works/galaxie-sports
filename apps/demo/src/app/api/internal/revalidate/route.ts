/**
 * Revalidação do cache da demo pelas tags do change feed (POST `{ tags }`). Quem chama é o seguidor do
 * `ops.change_feed` que roda no próprio servidor (lib/cache/follower.ts): o `revalidateTag` só funciona
 * dentro de uma requisição. Sem sessão (o proxy deixa passar com o header), então, nesta ordem:
 * 1. só do próprio host (a não ser com DEMO_INTERNAL_URL, quando o servidor se chama por outro endereço);
 * 2. assinatura do header (segredo e janela de tempo) conferida antes de ler qualquer byte do corpo;
 * 3. corpo com teto (Content-Length e leitura em stream) e igual ao resumo assinado;
 * 4. qualquer tag que falhe vira 500, para o seguidor não avançar o cursor e tentar de novo.
 */
import { BodyTooLargeError, clientAddress, isLoopback, readBodyWithLimit } from '@/lib/cache/request-guard';
import { revalidateApiTags } from '@/lib/cache/revalidate';
import {
  REVALIDATE_HEADER,
  bodyMatches,
  revalidateSecret,
  verifyRevalidateHeader,
} from '@/lib/cache/signature';
import { parseTagList } from '@/lib/cache/tags';

const NO_STORE = { 'cache-control': 'no-store' };
const BODY_MAX = 256_000;

const fail = (status: number, code: string) => Response.json({ code }, { status, headers: NO_STORE });

export async function POST(request: Request) {
  if (!process.env.DEMO_INTERNAL_URL && !isLoopback(clientAddress(request.headers)))
    return fail(403, 'forbidden');
  const signed = verifyRevalidateHeader(
    request.headers.get(REVALIDATE_HEADER),
    revalidateSecret(),
    Date.now(),
  );
  if (!signed) return fail(401, 'unauthorized');

  let raw: string;
  try {
    raw = await readBodyWithLimit(request, BODY_MAX);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return fail(413, 'too_large');
    throw err;
  }
  if (!bodyMatches(signed.digest, raw)) return fail(401, 'unauthorized');

  let body: { tags?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = {};
  }
  const tags = parseTagList(body.tags);
  if (!tags) return fail(400, 'invalid_tags');
  const { revalidated, failed } = revalidateApiTags(tags);
  if (failed.length)
    return Response.json(
      { code: 'revalidate_failed', data: { revalidated, failed } },
      { status: 500, headers: NO_STORE },
    );
  return Response.json({ data: { revalidated } }, { headers: NO_STORE });
}
