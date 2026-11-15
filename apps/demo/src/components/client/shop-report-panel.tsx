import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ShopReport, ShopReportRow } from '@/lib/client/shop-report';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { ShopReportFilters } from './shop-report-filters';

/**
 * Relatório do Shopping no painel do cliente (#930): cliques do widget dele por jogo, time, loja, widget, produto e
 * dia. Pedidos, vendas e comissão entram com a conciliação (#929).
 */
export async function ShopReportPanel({
  report,
  period,
}: {
  report: ShopReport;
  period: { from: string; to: string };
}) {
  const [{ t }, f] = await Promise.all([getI18n(), getFormatters()]);
  const T = t.shopping.report;
  const max = Math.max(1, ...report.byDay.map((d) => d.clicks));

  const table = (
    title: string,
    head: string,
    rows: ShopReportRow[],
    extra?: (r: ShopReportRow) => string,
  ) => (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{head}</TableHead>
            <TableHead className="text-right">{T.clicks}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id || 'none'}>
              <TableCell className="text-xs">
                {r.label || T.removedWidget}
                {extra?.(r) ? <span className="text-muted-foreground ml-1">· {extra(r)}</span> : null}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">{f.number(r.clicks)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
  const eventInfo = new Map(report.byEvent.map((e) => [e.id, e]));
  const productStore = new Map(report.topProducts.map((p) => [p.id, p.store]));

  return (
    <div className="flex flex-col gap-4">
      <ShopReportFilters period={period} options={report.options} />
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.title}</FrameTitle>
              <FrameDescription>{T.description}</FrameDescription>
            </div>
            <Badge variant="primary-light">{fill(T.total, { count: f.number(report.total) })}</Badge>
          </FrameHeader>
          {report.total ? (
            <div className="grid gap-6 border-t p-4 lg:grid-cols-2">
              {table(T.byEvent, T.event, report.byEvent, (r) => {
                const e = eventInfo.get(r.id);
                return [e?.competition, e?.startsAt ? f.dateTime(e.startsAt) : null]
                  .filter(Boolean)
                  .join(' · ');
              })}
              {table(T.topProducts, T.product, report.topProducts, (r) => productStore.get(r.id) ?? '')}
              {table(T.byTeam, T.team, report.byTeam)}
              {table(T.byStore, T.store, report.byStore)}
              {table(T.byWidget, T.widget, report.byWidget)}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{T.byDay}</p>
                <ul className="flex flex-col gap-1">
                  {report.byDay.map((d) => (
                    <li key={d.day} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{d.day}</span>
                      <span
                        className="bg-primary/60 h-2 rounded-full"
                        style={{ width: `${(d.clicks / max) * 100}%` }}
                      />
                      <span className="tabular-nums">{f.number(d.clicks)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground border-t p-4 text-sm">{T.empty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
