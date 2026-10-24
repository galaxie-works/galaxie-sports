'use client';

import { Check, ChevronLeft, ChevronRight, FilePenLine, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import {
  PAGE_SIZE,
  filtersQuery,
  itemSegment,
  type ReviewFilters,
  type ReviewListRow,
} from '@/lib/review/types';

import { STATE_BADGE, marketLabel, sportLabel } from './labels';
import { ReviewBulkBar } from './review-bulk';
import { useDecide } from './use-decide';

interface Props {
  items: ReviewListRow[];
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

/** Texto numa linha só, cortado com reticências; o clique mostra o texto inteiro num balão. */
function Truncated({ text, className }: { text: string; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={text}
            className={`block max-w-72 cursor-pointer truncate text-left underline-offset-4 hover:underline ${className ?? ''}`}
          />
        }
      >
        {text}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-80 w-96 max-w-[90vw] overflow-y-auto whitespace-pre-wrap"
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}

/** O que revisar: a sugestão em aberto (se houver) e o resumo do conteúdo, cada um cortado em uma linha. */
function Summary({ item }: { item: ReviewListRow }) {
  const { t } = useI18n();
  const T = t.review;
  if (!item.summary && !item.openSuggestion) return <>—</>;
  return (
    <>
      {item.openSuggestion ? (
        <Truncated
          text={`${T.table.suggestion}: ${item.openSuggestion}`}
          className="text-amber-600 dark:text-amber-400"
        />
      ) : null}
      {item.summary ? (
        <Truncated
          text={item.summary}
          className={item.openSuggestion ? 'text-muted-foreground text-xs' : undefined}
        />
      ) : null}
    </>
  );
}

/**
 * Ações rápidas de uma linha: aprovar e voltar para rascunho na hora (com "Desfazer" no aviso) e
 * sugerir edição, que abre o detalhe (o comentário é escrito lá).
 */
function RowActions({ item, filters }: { item: ReviewListRow; filters: ReviewFilters }) {
  const { t } = useI18n();
  const T = t.review;
  const { send, pending } = useDecide(item.id);
  const quick = (action: 'approve' | 'draft', label: string, icon: React.ReactNode, disabled: boolean) => {
    // desfazer só volta a um status que a ação inversa recria (a sugestão em aberto não volta)
    const undo =
      action === 'approve'
        ? item.state === 'draft'
          ? 'draft'
          : undefined
        : item.state === 'approved'
          ? 'approve'
          : undefined;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant={action === 'approve' ? 'default' : 'outline'}
              disabled={pending || disabled}
              onClick={() => void send(action, { undo })}
            >
              {pending ? <Spinner /> : icon}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };
  return (
    <div className="flex items-center gap-1">
      {quick('approve', T.actions.approve, <Check />, item.state === 'approved')}
      {quick('draft', T.actions.draft, <Undo2 />, item.state === 'draft')}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={T.actions.suggest}
              render={<Link href={itemHref(item.id, filters)} />}
              nativeButton={false}
            >
              <FilePenLine />
            </Button>
          }
        />
        <TooltipContent>{T.actions.suggest}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ReviewTable({ items, total, filters, timeZone }: Props) {
  const { t, locale } = useI18n();
  const T = t.review;
  const f = useFormatters(timeZone);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // outra página, outros filtros ou a lista recarregada: a seleção vale só para os itens à vista
  const visibleKey = items.map((i) => i.id).join('\n');
  useEffect(() => {
    const visible = new Set(visibleKey.split('\n'));
    setSelected((prev) => {
      const kept = new Set([...prev].filter((id) => visible.has(id)));
      return kept.size === prev.size ? prev : kept;
    });
  }, [visibleKey]);

  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      {selected.size ? <ReviewBulkBar ids={[...selected]} onDone={() => setSelected(new Set())} /> : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  aria-label={T.bulk.selectAll}
                  checked={allChecked}
                  indeterminate={!allChecked && selected.size > 0}
                  onCheckedChange={(on) => setSelected(on ? new Set(items.map((i) => i.id)) : new Set())}
                />
              </TableHead>
              <TableHead>{T.table.item}</TableHead>
              <TableHead className="hidden md:table-cell">{T.table.summary}</TableHead>
              <TableHead>{T.table.kind}</TableHead>
              <TableHead>{T.table.sport}</TableHead>
              <TableHead>{T.table.market}</TableHead>
              <TableHead>{T.table.locale}</TableHead>
              <TableHead>{T.table.state}</TableHead>
              <TableHead>{T.table.decision}</TableHead>
              <TableHead className="bg-background sticky right-0">{T.table.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-state={selected.has(item.id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={fill(T.bulk.selectRow, { title: item.title })}
                    checked={selected.has(item.id)}
                    onCheckedChange={(on) => toggle(item.id, on)}
                  />
                </TableCell>
                <TableCell className="max-w-56 md:max-w-64">
                  <Link
                    href={itemHref(item.id, filters)}
                    className="hover:text-primary block truncate font-medium underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="text-muted-foreground block truncate font-mono text-xs">{item.key}</span>
                  {/* no celular a coluna "O que revisar" fica escondida pelas ações: o resumo vem aqui */}
                  <div className="mt-1 md:hidden">
                    <Summary item={item} />
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-72 md:table-cell">
                  <Summary item={item} />
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
                <TableCell className="bg-background sticky right-0">
                  <RowActions item={item} filters={filters} />
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
