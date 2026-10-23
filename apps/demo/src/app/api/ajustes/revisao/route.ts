/**
 * Lista da revisão semântica em JSON (admin): itens filtrados, contagens por status e as opções dos
 * filtros. Mesmos parâmetros da página (`tipo`, `esporte`, `mercado`, `locale`, `status`, `q`, `pagina`).
 */
import { requireAdminApi } from '@/lib/review/guard';
import { ReviewUnavailableError, listReviewItems } from '@/lib/review/store';
import { parseFilters } from '@/lib/review/types';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request) {
  const actor = await requireAdminApi(request);
  if (actor instanceof Response) return actor;
  try {
    const data = await listReviewItems(parseFilters(new URL(request.url).searchParams));
    return Response.json({ data }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ReviewUnavailableError)
      return Response.json({ code: 'unavailable' }, { status: 503, headers: NO_STORE });
    throw err;
  }
}
