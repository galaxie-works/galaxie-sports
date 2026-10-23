/**
 * Um item da revisão semântica (admin). GET: conteúdo, original da tradução, prévia do que a API
 * serviria, histórico e o piso editorial da API (`serving`, para dizer se o item é servido hoje). POST `{ action, comment?, fields? }`: aprovar (`approve`), voltar para rascunho
 * (`draft`) ou sugerir edição (`suggest`, com comentário obrigatório e edição proposta opcional). Cada
 * ação fica na auditoria com quem fez e quando, e a API reflete a decisão na hora (docs/06 §2.1).
 */
import { requireAdminApi } from '@/lib/review/guard';
import { previewFor } from '@/lib/review/preview';
import {
  ReviewInputError,
  ReviewUnavailableError,
  decideReview,
  getReviewItem,
  readServingFloor,
} from '@/lib/review/store';
import { REVIEW_ACTIONS, type ReviewAction } from '@/lib/review/types';

const NO_STORE = { 'cache-control': 'no-store' };
const BODY_MAX = 64_000;

type Ctx = { params: Promise<{ id: string }> };

function failure(err: unknown) {
  if (err instanceof ReviewInputError)
    return Response.json(
      { code: err.code },
      { status: err.code === 'not_found' ? 404 : 400, headers: NO_STORE },
    );
  if (err instanceof ReviewUnavailableError)
    return Response.json({ code: 'unavailable' }, { status: 503, headers: NO_STORE });
  throw err;
}

export async function GET(request: Request, { params }: Ctx) {
  const actor = await requireAdminApi(request);
  if (actor instanceof Response) return actor;
  const { id } = await params;
  try {
    const [item, serving] = await Promise.all([getReviewItem(decodeURIComponent(id)), readServingFloor()]);
    if (!item) return Response.json({ code: 'not_found' }, { status: 404, headers: NO_STORE });
    return Response.json({ data: { ...item, preview: previewFor(item), serving } }, { headers: NO_STORE });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const actor = await requireAdminApi(request);
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const raw = await request.text();
  let body: { action?: unknown; comment?: unknown; fields?: unknown };
  try {
    body = raw.length <= BODY_MAX ? (JSON.parse(raw) as typeof body) : {};
  } catch {
    body = {};
  }
  if (!REVIEW_ACTIONS.includes(body.action as ReviewAction))
    return Response.json({ code: 'invalid_action' }, { status: 400, headers: NO_STORE });
  if (body.comment != null && typeof body.comment !== 'string')
    return Response.json({ code: 'invalid_fields' }, { status: 400, headers: NO_STORE });
  try {
    const result = await decideReview({
      itemId: decodeURIComponent(id),
      action: body.action as ReviewAction,
      comment: (body.comment as string | null | undefined) ?? null,
      fields: (body.fields as Record<string, unknown> | null | undefined) ?? null,
      actor,
    });
    return Response.json({ data: result }, { headers: NO_STORE });
  } catch (err) {
    return failure(err);
  }
}
