'use client';

import { type ColumnDef, useTable } from '@tanstack/react-table';
import { Check, CheckCheck, EyeOff, MoreHorizontal, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import { toast } from 'sonner';

import { decideLineupItem, dismissLineupItemChange } from '@/app/[locale]/(app)/ajustes/grades/actions';
import { Badge } from '@/components/reui/badge';
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination';
import { DataGridScrollArea } from '@/components/reui/data-grid/data-grid-scroll-area';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import {
  ADMIN_TABS,
  STATUS_FILTERS,
  TARGET_TYPES,
  lineupFiltersQuery,
  type AdminTab,
  type ItemView,
  type LineupFilters,
  type LineupStatus,
  type StatusFilter,
} from '@/lib/lineup/types';
import { cn } from '@/lib/utils';

import { ItemLogo, SourceLine, StatusBadge, useFieldText } from './parts';
import { VerificationCell } from './verification';

const ALL = '__all';

export interface ReviewRow extends ItemView {
  planName: string | null;
  platform: { id: string; name: string; country: string };
  /** Plano e complemento: preço cheio provado, com a moeda. */
  price?: { amount: number; currency: string } | null;
  /** Complemento com fidelidade. */
  commitmentMonths?: number | null;
}

/** Abas de Ajustes → Grades e ofertas (revisão, pedidos das operadoras, operadora de cada tenant). */
export function LineupAdminTabs({ active, open }: { active: AdminTab; open: number }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.lineup.admin.title} className="flex flex-wrap gap-1 border-b">
      {ADMIN_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/ajustes/grades?aba=${tab}`}
          aria-current={active === tab ? 'page' : undefined}
          className={cn(
            'text-muted-foreground hover:text-foreground -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium',
            active === tab && 'border-primary text-foreground',
          )}
        >
          {t.lineup.admin.tabs[tab]}
          {tab === 'pedidos' && open ? (
            <span className="bg-warning/15 text-warning rounded-full px-1.5 text-xs tabular-nums">
              {open}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function Filters({
  filters,
  countries,
  platforms,
}: {
  filters: LineupFilters;
  countries: string[];
  platforms: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const F = t.lineup.admin.filters;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (patch: Partial<LineupFilters>) =>
    startTransition(() => router.replace(`${pathname}${lineupFiltersQuery({ ...filters, ...patch })}`));
  const countryName = (c: string) => (t.nav.countries as Record<string, string>)[c] ?? c;
  const statusName = (s: StatusFilter) => (s === 'pending' ? F.pending : t.lineup.statuses[s]);

  const select = (
    label: string,
    value: string | null,
    values: { value: string; label: string }[],
    onChange: (v: string | null) => void,
  ) => (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL || v == null ? null : String(v))}
      items={[
        { value: ALL, label: `${label}: ${F.all}` },
        ...values.map((v) => ({ ...v, label: `${label}: ${v.label}` })),
      ]}
    >
      <SelectTrigger size="sm" aria-label={label} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`${label}: ${F.all}`}</SelectItem>
        {values.map((v) => (
          <SelectItem key={v.value} value={v.value}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {select(
        F.country,
        filters.country,
        countries.map((c) => ({ value: c, label: countryName(c) })),
        (country) => go({ country }),
      )}
      {select(
        F.platform,
        filters.platform,
        platforms.map((p) => ({ value: p.id, label: p.name })),
        (platform) => go({ platform }),
      )}
      {select(
        F.type,
        filters.type,
        TARGET_TYPES.map((x) => ({ value: x, label: t.lineup.types[x] })),
        (type) => go({ type: type as LineupFilters['type'] }),
      )}
      {select(
        F.status,
        filters.status,
        STATUS_FILTERS.map((s) => ({ value: s, label: statusName(s) })),
        (status) => go({ status: status as StatusFilter | null }),
      )}
      {filters.country || filters.platform || filters.type || filters.status !== 'pending' ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => startTransition(() => router.replace(`${pathname}?aba=revisao`))}
        >
          <X />
          {F.clear}
        </Button>
      ) : null}
      {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
    </div>
  );
}

/** Mudança que a pesquisa encontrou num item já revisado ou aprovado: atual → novo. */
function PendingChange({ row }: { row: ReviewRow }) {
  const { t } = useI18n();
  const C = t.lineup.admin.change;
  const text = useFieldText();
  const change = row.pendingChange;
  if (!change) return null;
  const entries = Object.entries(change).filter(([k]) => k !== 'seen_at' && k !== 'removed');
  return (
    <div className="border-warning/40 bg-warning/5 mt-1.5 flex flex-col gap-0.5 rounded-md border px-2 py-1 text-xs">
      <span className="font-medium">{change.removed ? C.removed : C.title}</span>
      {entries.map(([k, v]) => (
        <span key={k} className="text-muted-foreground">
          {text.label(k)}:{' '}
          <span className="line-through">{text.value(k, (row.fields as Record<string, unknown>)[k])}</span> →{' '}
          <span className="text-foreground">{text.value(k, v)}</span>
        </span>
      ))}
      <span className="text-muted-foreground italic">{C.hint}</span>
    </div>
  );
}

function Actions({ row }: { row: ReviewRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const A = t.lineup.admin;
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? t.lineup.errors.generic);
      toast.success(done);
      router.refresh();
    });
  const decide = (status: LineupStatus) =>
    run(() => decideLineupItem({ type: row.type, id: row.id }, status), A.decided[status]);
  const changed = row.pendingChange !== null;
  const button = (
    status: LineupStatus,
    label: string,
    icon: React.ReactNode,
    variant: 'default' | 'outline',
  ) => (
    <Button
      size="icon-sm"
      variant={variant}
      aria-label={`${label}: ${row.name}`}
      title={label}
      // Aprovar de novo um item aprovado com mudança encontrada aplica a mudança.
      disabled={pending || (row.status === status && !(status === 'approved' && changed))}
      onClick={() => decide(status)}
    >
      {icon}
    </Button>
  );
  const item = (status: LineupStatus, label: string, icon: React.ReactNode) => (
    <DropdownMenuItem
      variant={status === 'rejected' ? 'destructive' : 'default'}
      disabled={row.status === status}
      onClick={() => decide(status)}
    >
      {icon}
      {label}
    </DropdownMenuItem>
  );
  // aprovar à vista; o resto da decisão num menu, para a coluna caber na largura da tela
  return (
    <div className="flex items-center gap-1">
      {button('approved', A.actions.approve, <Check />, 'default')}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending}
              aria-label={`${A.actions.more}: ${row.name}`}
              title={A.actions.more}
            />
          }
        >
          {pending ? <Spinner /> : <MoreHorizontal />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {item('reviewed', A.actions.reviewed, <CheckCheck />)}
          {item('draft', A.actions.draft, <Undo2 />)}
          {changed ? (
            <DropdownMenuItem
              onClick={() =>
                run(() => dismissLineupItemChange({ type: row.type, id: row.id }), A.decided.dismissed)
              }
            >
              <EyeOff />
              {A.actions.dismiss}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {item('rejected', A.actions.reject, <X />)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Colunas da revisão: largura fixa por coluna; o que não cabe rola na horizontal dentro do grid. */
function useColumns(timeZone: string): ColumnDef<DataGridFeatures, ReviewRow>[] {
  const { t } = useI18n();
  const A = t.lineup.admin;
  const f = useFormatters(timeZone);
  return useMemo<ColumnDef<DataGridFeatures, ReviewRow>[]>(
    () => [
      {
        id: 'item',
        header: A.table.item,
        cell: ({ row: { original: row } }) => (
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <ItemLogo name={row.name} url={row.logoUrl} className="size-7" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium" title={row.name}>
                  {row.name}
                </span>
                {row.planName ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {fill(A.table.inPlan, { plan: row.planName })}
                  </span>
                ) : null}
              </div>
            </div>
            <PendingChange row={row} />
          </div>
        ),
        size: 230,
      },
      {
        id: 'type',
        header: A.table.type,
        cell: ({ row }) => t.lineup.types[row.original.type],
        size: 100,
      },
      {
        id: 'platform',
        header: A.table.platform,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate" title={row.original.platform.name}>
              {row.original.platform.name}
            </span>
            <span className="text-muted-foreground text-xs">{row.original.platform.country}</span>
          </div>
        ),
        size: 130,
      },
      {
        id: 'source',
        header: A.table.source,
        cell: ({ row }) => <SourceLine sources={row.original.sources} timeZone={timeZone} />,
        size: 140,
      },
      {
        id: 'verification',
        header: A.table.verification,
        cell: ({ row: { original: row } }) =>
          row.type === 'platform' ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            <VerificationCell
              verification={row.verification}
              price={row.price}
              access={row.fields.access ?? null}
              isPlan={row.type === 'plan' || row.type === 'addon'}
              commitmentMonths={row.commitmentMonths ?? null}
              timeZone={timeZone}
            />
          ),
        meta: { cellClassName: 'whitespace-normal break-words' },
        size: 250,
      },
      {
        id: 'status',
        header: A.table.status,
        // situação e, embaixo, a última decisão (quem e quando)
        cell: ({ row: { original: row } }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              <StatusBadge status={row.status} />
              {row.pendingChange ? <Badge variant="warning-light">{A.change.title}</Badge> : null}
            </div>
            {row.reviewedBy && row.reviewedAt ? (
              <span className="text-muted-foreground text-xs break-words" title={A.table.decision}>
                {fill(A.decidedBy, { who: row.reviewedBy, when: f.relative(row.reviewedAt) })}
              </span>
            ) : null}
          </div>
        ),
        size: 160,
      },
      {
        id: 'actions',
        header: A.table.actions,
        cell: ({ row }) => <Actions row={row.original} />,
        size: 120,
      },
    ],
    [A, t, f, timeZone],
  );
}

/** Revisão dos itens da grade: filtros, fonte e data, situação, mudança encontrada, última decisão e ações. */
export function LineupReview({
  rows,
  filters,
  countries,
  platforms,
  catalogEmpty,
  timeZone,
}: {
  rows: ReviewRow[];
  filters: LineupFilters;
  countries: string[];
  platforms: { id: string; name: string }[];
  catalogEmpty: boolean;
  timeZone: string;
}) {
  const { t, locale } = useI18n();
  const A = t.lineup.admin;
  const grid = t.admin.table.grid;
  const columns = useColumns(timeZone);
  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (row) => `${row.type}:${row.id}`,
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
  });
  const empty = catalogEmpty ? A.emptyCatalog : A.empty;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Filters filters={filters} countries={countries} platforms={platforms} />
      <DataGrid
        table={table}
        recordCount={rows.length}
        emptyMessage={empty}
        tableLayout={{ headerBackground: true, width: 'fixed' }}
        tableClassNames={{ bodyRow: 'align-top [&>td]:align-top' }}
        i18n={{
          labels: {
            rowsPerPage: grid.rowsPerPage,
            paginationInfo: ({ from, to, count }) => fill(grid.paginationInfo, { from, to, count }),
            sortAscending: grid.sortAscending,
            sortDescending: grid.sortDescending,
            previousPage: grid.previousPage,
            nextPage: grid.nextPage,
            goToPage: (page) => fill(grid.goToPage, { page }),
            loading: grid.loading,
            empty,
          },
        }}
      >
        <DataGridContainer className="rounded-lg border">
          <DataGridScrollArea orientation="horizontal">
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
        {rows.length > 25 ? <DataGridPagination sizes={[25, 50, 100]} /> : null}
      </DataGrid>
      <span className="text-muted-foreground text-sm">{plural(locale, rows.length, A.table.total)}</span>
    </div>
  );
}
