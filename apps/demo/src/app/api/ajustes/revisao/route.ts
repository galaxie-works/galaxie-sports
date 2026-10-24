/**
 * Lista da revisão semântica em JSON (admin): itens filtrados, contagens por status, as opções dos
 * filtros e o piso editorial que a API relatou (`serving`). Mesmos parâmetros da página (`tipo`, `esporte`, `mercado`, `locale`, `status`, `q`, `pagina`).
 */
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { requireAdminApi } from '@/lib/review/guard';
import { ReviewUnavailableError, listReviewItems, readServingFloor } from '@/lib/review/store';
import { parseFilters } from '@/lib/review/types';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request) {
  const actor = await requireAdminApi(request);
  if (actor instanceof Response) return actor;
  try {
    // JSON para integrações: o resumo sai no idioma padrão (fora do Next, sem cookie de idioma)
    const t = getDictionary(DEFAULT_LOCALE);
    const [data, serving] = await Promise.all([
      listReviewItems(parseFilters(new URL(request.url).searchParams), t.review.summary),
      readServingFloor(),
    ]);
    return Response.json({ data: { ...data, serving } }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ReviewUnavailableError)
      return Response.json({ code: 'unavailable' }, { status: 503, headers: NO_STORE });
    throw err;
  }
}
