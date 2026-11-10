'use client';

import { type ColumnDef, useTable } from '@tanstack/react-table';
import { CircleDot, Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { filterLabels } from '@/components/live/live-filter-bar';
import { Badge } from '@/components/reui/badge';
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import { Filters, FiltersRow } from '@/components/reui/filters/filters';
import { createFilterQuery, flattenFilterRules } from '@/components/reui/filters/filters-query';
import type { FilterField, FilterOperator, FilterQuery } from '@/components/reui/filters/filters-types';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { ExplainEmpty } from '@/components/settings';
import { sortByLabel } from '@/lib/alphabetical';
import type { StaffWalletRow } from '@/lib/cosmos/staff-data';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export type WalletState = 'active' | 'blocked' | 'depleted' | 'disabled';

/** Estado mostrado na tabela: desligada pelo cliente, bloqueada (Galaxie ou saldo zerado) ou ativa. */
export function walletState(r: Pick<StaffWalletRow, 'enabled' | 'status' | 'blockReason'>): WalletState {
  if (!r.enabled) return 'disabled';
  if (r.status === 'blocked') return r.blockReason === 'depleted' ? 'depleted' : 'blocked';
  return 'active';
}

const STATE_BADGE: Record<
  WalletState,
  'success-light' | 'warning-light' | 'destructive-light' | 'secondary'
> = {
  active: 'success-light',
  depleted: 'warning-light',
  blocked: 'destructive-light',
  disabled: 'secondary',
};

const OPERATOR = 'is_any_of';

/** Todas as carteiras (data-grid do ReUI) com a barra de filtros do c-filters-3 por estado e mercado. */
export function WalletsTable({ rows, timeZone }: { rows: StaffWalletRow[]; timeZone: string }) {
  const { t, locale } = useI18n();
  const T = t.cosmosStaff;
  const grid = t.admin.table.grid;
  const router = useRouter();
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery([]));

  const picked = useMemo(() => {
    const out: Record<'state' | 'market', string[]> = { state: [], market: [] };
    for (const rule of flattenFilterRules(query)) {
      const field = rule.path[0] as 'state' | 'market' | undefined;
      if (field !== 'state' && field !== 'market') continue;
      const raw = Array.isArray(rule.value) ? (rule.value as unknown[]) : [rule.value];
      out[field] = raw.filter((v): v is string => typeof v === 'string' && v !== '');
    }
    return out;
  }, [query]);

  const data = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!picked.state.length || picked.state.includes(walletState(r))) &&
          (!picked.market.length || r.markets.some((m) => picked.market.includes(m.toUpperCase()))),
      ),
    [rows, picked],
  );

  const columns = useMemo<ColumnDef<DataGridFeatures, StaffWalletRow>[]>(() => {
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
    const brl = new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' });
    const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });
    const c = T.columns;
    return [
      {
        id: 'tenant',
        accessorFn: (r) => r.name,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.tenant} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="text-muted-foreground truncate text-xs">{row.original.slug}</span>
          </div>
        ),
        size: 200,
      },
      {
        id: 'status',
        accessorFn: (r) => walletState(r),
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.status} />,
        cell: ({ row }) => {
          const s = walletState(row.original);
          return <Badge variant={STATE_BADGE[s]}>{T.status[s]}</Badge>;
        },
        size: 130,
      },
      {
        id: 'balance',
        accessorFn: (r) => r.available,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.balance} />,
        cell: ({ row }) => <span className="tabular-nums">{n.format(row.original.available)}</span>,
        size: 110,
      },
      {
        id: 'used',
        accessorFn: (r) => r.usedCredits,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.used} />,
        cell: ({ row }) => <span className="tabular-nums">{n.format(row.original.usedCredits)}</span>,
        size: 140,
      },
      {
        id: 'cost',
        accessorFn: (r) => r.costUsd,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.cost} />,
        cell: ({ row }) => <span className="tabular-nums">{usd.format(row.original.costUsd)}</span>,
        size: 110,
      },
      {
        id: 'revenue',
        accessorFn: (r) => r.revenueCents.brl + r.revenueCents.usd,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.revenue} />,
        cell: ({ row }) => {
          const { brl: b, usd: u } = row.original.revenueCents;
          const parts = [b ? brl.format(b / 100) : null, u ? usd.format(u / 100) : null].filter(Boolean);
          return <span className="tabular-nums">{parts.length ? parts.join(' · ') : T.none}</span>;
        },
        size: 150,
      },
      {
        id: 'margin',
        accessorFn: (r) => r.marginUsd ?? -Infinity,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.margin} />,
        cell: ({ row }) => (
          <span className="tabular-nums" title={T.marginHint}>
            {row.original.marginUsd === null ? T.none : usd.format(row.original.marginUsd)}
          </span>
        ),
        size: 110,
      },
      {
        id: 'lastPurchase',
        accessorFn: (r) => r.lastPurchaseAt?.getTime() ?? 0,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.lastPurchase} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.lastPurchaseAt ? day.format(new Date(row.original.lastPurchaseAt)) : T.never}
          </span>
        ),
        size: 140,
      },
    ];
  }, [T, locale, timeZone]);

  const table = useTable({
    features: dataGridFeatures,
    data,
    columns,
    getRowId: (r) => r.tenantId,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });

  const inUse = new Set(query.rules.flatMap((r) => (r.type === 'rule' ? r.path : [])));
  const operators: FilterOperator[] = [{ value: OPERATOR, label: T.filters.operator, arity: 'many' }];
  const markets = [...new Set(rows.flatMap((r) => r.markets.map((m) => m.toUpperCase())))];
  const fields: FilterField[] = [
    {
      id: 'state',
      label: T.filters.status,
      type: 'select',
      operators,
      defaultOperator: OPERATOR,
      disabled: inUse.has('state'),
      icon: <CircleDot aria-hidden />,
      searchable: false,
      options: sortByLabel(
        (['active', 'blocked', 'depleted', 'disabled'] as const).map((s) => ({
          value: s,
          label: T.status[s],
        })),
      ),
    },
    {
      id: 'market',
      label: T.filters.market,
      type: 'select',
      operators,
      defaultOperator: OPERATOR,
      disabled: inUse.has('market'),
      icon: <Globe aria-hidden />,
      options: sortByLabel(markets.map((m) => ({ value: m, label: m }))),
    },
  ];

  if (!rows.length)
    return (
      <ExplainEmpty title={T.emptyTitle} description={T.emptyDescription} className="rounded-xl border" />
    );

  return (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        <div role="search" aria-label={T.filters.label} className="min-w-0 px-4 pb-3">
          <Filters
            fields={fields}
            query={query}
            onQueryChange={(q) =>
              setQuery({
                ...q,
                rules: q.rules.map((r) =>
                  r.type === 'rule' && !r.operator ? { ...r, operator: OPERATOR } : r,
                ),
              })
            }
            labels={filterLabels(locale, t.live.filters.ui)}
            size="sm"
          >
            <FiltersRow showClear />
          </Filters>
        </div>
        <DataGrid
          table={table}
          recordCount={data.length}
          emptyMessage={T.filteredEmpty}
          onRowClick={(r) => router.push(`/ajustes/carteiras/${r.tenantId}`)}
          tableLayout={{ headerBackground: true }}
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
              empty: T.filteredEmpty,
            },
          }}
        >
          <DataGridContainer>
            <DataGridTable />
          </DataGridContainer>
        </DataGrid>
      </FramePanel>
    </Frame>
  );
}
