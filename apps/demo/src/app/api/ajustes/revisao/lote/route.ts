/**
 * Decisão em massa na revisão semântica (admin). POST `{ ids, action, comment? }`: a mesma ação de
 * `/api/ajustes/revisao/{id}` (aprovar, voltar para rascunho ou sugerir edição, com comentário
 * obrigatório) em até MAX_IDS itens, um por vez, cada um com a sua auditoria. Responde quantos mudaram,
 * quantos já estavam assim e os que falharam (com o código do erro).
 */
import { revalidateApiTags } from '@/lib/cache/revalidate';
import { requireAdminApi } from '@/lib/review/guard';
import { ReviewInputError, ReviewUnavailableError, decideReview } from '@/lib/review/store';
import { MAX_PAGE_SIZE, REVIEW_ACTIONS, type ReviewAction } from '@/lib/review/types';
import { rejectCrossSite } from '@/lib/security/same-origin';

const NO_STORE = { 'cache-control': 'no-store' };
/** Cabe uma página de 500 ids (chaves longas, como as de tradução) e o comentário. */
const BODY_MAX = 128_000;
/** Uma página inteira da lista, no maior tamanho que ela aceita (`?per=`). */
const MAX_IDS = MAX_PAGE_SIZE;

export async function POST(request: Request) {
  // CSRF: só a própria demo, com corpo JSON (lib/security/same-origin.ts)
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const actor = await requireAdminApi(request);
  if (actor instanceof Response) return actor;
  const raw = await request.text();
  let body: { ids?: unknown; action?: unknown; comment?: unknown };
  try {
    body = raw.length <= BODY_MAX ? (JSON.parse(raw) as typeof body) : {};
  } catch {
    body = {};
  }
  if (!REVIEW_ACTIONS.includes(body.action as ReviewAction))
    return Response.json({ code: 'invalid_action' }, { status: 400, headers: NO_STORE });
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string'))] : [];
  if (!ids.length || ids.length > MAX_IDS || (body.comment != null && typeof body.comment !== 'string'))
    return Response.json({ code: 'invalid_fields' }, { status: 400, headers: NO_STORE });

  let changed = 0;
  let unchanged = 0;
  const failed: { id: string; code: string }[] = [];
  const tags = new Set<string>();
  try {
    for (const id of ids) {
      try {
        const result = await decideReview({
          itemId: id,
          action: body.action as ReviewAction,
          comment: (body.comment as string | undefined) ?? null,
          fields: null,
          actor,
        });
        for (const t of result.tags) tags.add(t);
        if (result.unchanged) unchanged++;
        else changed++;
      } catch (err) {
        if (err instanceof ReviewUnavailableError)
          return Response.json({ code: 'unavailable' }, { status: 503, headers: NO_STORE });
        if (!(err instanceof ReviewInputError)) throw err;
        // comentário ausente ou longo vale para todos: devolve o erro de uma vez
        if (err.code === 'comment_required' || err.code === 'comment_too_long')
          return Response.json({ code: err.code }, { status: 400, headers: NO_STORE });
        failed.push({ id, code: err.code });
      }
    }
  } finally {
    // o que já foi decidido (e publicado no change feed) aparece na demo na hora, mesmo se o lote parou no meio
    revalidateApiTags(tags);
  }
  return Response.json({ data: { changed, unchanged, failed } }, { headers: NO_STORE });
}
