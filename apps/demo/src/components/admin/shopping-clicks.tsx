import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/lib/auth/admin';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { SHOP_CLICK_DAYS, shopClickSummary } from '@/lib/shop/clicks';

/**
 * Ajustes → Engajamento → Shopping: cliques dos últimos 30 dias (#921), por loja, origem, dia e os jogos que mais
 * renderam clique. É o número que troca as premissas do estudo do épico (#909) por dados reais.
 */
export async function ShoppingClicks() {
  // sessão de admin conferida aqui também: o painel tem o Suspense dele
  await requireAdmin();
  const [{ t }, f, s] = await Promise.all([getI18n(), getFormatters(), shopClickSummary()]);
  const T = t.shopping.clicks;
  const max = Math.max(1, ...s.byDay.map((d) => d.clicks));
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
          <div className="flex flex-col gap-1">
            <FrameTitle>{fill(T.title, { days: SHOP_CLICK_DAYS })}</FrameTitle>
            <FrameDescription>{T.description}</FrameDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary-light">{fill(T.total, { count: s.total })}</Badge>
            {s.byOrigin.map((o) => (
              <Badge key={o.origin} variant="secondary">
                {T.origins[o.origin as keyof typeof T.origins] ?? o.origin} · {o.clicks}
              </Badge>
            ))}
          </div>
        </FrameHeader>
        {s.total ? (
          <div className="grid gap-4 border-t p-4 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{T.byStore}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.store}</TableHead>
                    <TableHead className="text-right">{T.clicks}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.byStore.map((r) => (
                    <TableRow key={r.storeId}>
                      <TableCell className="text-xs">{r.storeName}</TableCell>
                      <TableCell className="text-right text-xs">{r.clicks}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{T.topEvents}</p>
              {s.topEvents.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{T.event}</TableHead>
                      <TableHead className="text-right">{T.clicks}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.topEvents.map((e) => (
                      <TableRow key={e.eventId}>
                        <TableCell className="text-xs">
                          <Link href={`/eventos/${e.eventId}`} className="hover:underline">
                            {e.title}
                          </Link>
                          {e.startsAt ? (
                            <span className="text-muted-foreground ml-1">· {f.dateTime(e.startsAt)}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-xs">{e.clicks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-xs">{T.noEvents}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{T.byDay}</p>
              <ul className="flex flex-col gap-1">
                {s.byDay.map((d) => (
                  <li key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-20 shrink-0 tabular-nums">{d.day}</span>
                    <span
                      className="bg-primary/60 h-2 rounded-full"
                      style={{ width: `${(d.clicks / max) * 100}%` }}
                    />
                    <span className="tabular-nums">{d.clicks}</span>
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
  );
}
