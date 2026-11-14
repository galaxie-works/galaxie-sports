/**
 * Relatório do Shopping em CSV (#930): o período e os filtros da tela, só do tenant da sessão. Uma linha por dia,
 * jogo, time, loja, widget e produto, com os cliques. Os dias do período são os do fuso de quem olha, como na tela.
 */
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { shopClientReportRows, shopReportCsv, shopReportFilter } from '@/lib/client/shop-report';
import { periodFrom } from '@/lib/cosmos/data-utils';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale, getTimeZone } from '@/lib/i18n/server';

export async function GET(request: Request) {
  const ctx = await readClientContext();
  const locale = await getRequestLocale();
  const t = getDictionary(locale);
  if (!ctx) return Response.json({ title: t.common.unauthorized }, { status: 401 });
  // o mesmo que a tela exige: cargo com `billing.view` e o módulo shopping no tenant
  if (!ctx.tenant || !ctx.tenant.modules.includes('shopping') || !can(ctx, 'billing.view'))
    return Response.json({ title: t.common.forbidden }, { status: 403 });

  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) ?? undefined;
  const period = periodFrom({ from: q('from'), to: q('to') }, new Date(), await getTimeZone(locale));
  const filter = shopReportFilter(period, {
    competition: q('competition'),
    team: q('team'),
    store: q('store'),
  });
  const T = t.shopping.report;
  const rows = await shopClientReportRows(ctx.tenant.id, filter);
  const csv = shopReportCsv(
    [T.day, T.event, T.competition, T.team, T.store, T.widget, T.product, T.clicks],
    rows,
  );
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="shopping-cliques-${period.fromDay}-${period.toDay}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
