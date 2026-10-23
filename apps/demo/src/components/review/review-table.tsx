'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import {
  PAGE_SIZE,
  filtersQuery,
  itemSegment,
  type ReviewFilters,
  type ReviewListItem,
} from '@/lib/review/types';

import { STATE_BADGE, marketLabel, sportLabel } from './labels';

interface Props {
  items: ReviewListItem[];
  total: number;
  filters: ReviewFilters;
  timeZone: string;
}

/** Link do detalhe levando os filtros da lista (o "voltar" do detalhe volta para a mesma página). */
export const itemHref = (id: string, filters: ReviewFilters) => {
  const list = filtersQuery(filters);
  return `/ajustes/revisao/${itemSegment(id)}${list ? `?lista=${encodeURIComponent(list.slice(1))}` : ''}`;
};

const pageHref = (filters: ReviewFilters, page: number) =>
  `/ajustes/revisao${filtersQuery({ ...filters, page })}`;

function PageButton({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Button size="sm" variant="outline" render={<Link href={href} />} nativeButton={false}>
      {children}
    </Button>
  ) : (
    <Button size="sm" variant="outline" disabled>
      {children}
    </Button>
  );
}

export function ReviewTable({ items, total, filters, timeZone }: Props) {
  const { t, locale } = useI18n();
  const T = t.review;
  const f = useFormatters(timeZone);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.table.item}</TableHead>
              <TableHead>{T.table.kind}</TableHead>
              <TableHead>{T.table.sport}</TableHead>
              <TableHead>{T.table.market}</TableHead>
              <TableHead>{T.table.locale}</TableHead>
              <TableHead>{T.table.state}</TableHead>
              <TableHead>{T.table.decision}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-96">
                  <Link
                    href={itemHref(item.id, filters)}
                    className="hover:text-primary block truncate font-medium underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="text-muted-foreground block truncate font-mono text-xs">{item.key}</span>
                </TableCell>
                <TableCell>{T.kinds[item.kind]}</TableCell>
                <TableCell>{sportLabel(t, item.sport)}</TableCell>
                <TableCell>{item.market ? marketLabel(t, item.market) : '—'}</TableCell>
                <TableCell className="font-mono text-xs">{item.locale ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={STATE_BADGE[item.state]}>{T.states[item.state]}</Badge>
                    {item.stale ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<Badge variant="destructive-outline">{T.table.stale}</Badge>}
                        />
                        <TooltipContent className="max-w-72">
                          {fill(T.table.staleHint, { who: item.decidedBy ?? '—' })}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                  {item.decidedAt && item.decidedBy
                    ? fill(T.detail.decidedBy, { who: item.decidedBy, when: f.relative(item.decidedAt) })
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{plural(locale, total, T.table.total)}</span>
        {pages > 1 ? (
          <div className="flex items-center gap-2">
            <span>{fill(T.table.page, { page: filters.page, pages })}</span>
            <PageButton href={filters.page > 1 ? pageHref(filters, filters.page - 1) : null}>
              <ChevronLeft />
              {T.table.previous}
            </PageButton>
            <PageButton href={filters.page < pages ? pageHref(filters, filters.page + 1) : null}>
              {T.table.next}
              <ChevronRight />
            </PageButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
