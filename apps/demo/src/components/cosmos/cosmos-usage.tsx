'use client';

import { type ColumnDef, useTable } from '@tanstack/react-table';
import { Download, FunctionSquare, Layers, ListFilter } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Badge } from '@/components/reui/badge';
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import {
  createFilterQuery,
  createFilterRule,
  flattenFilterRules,
} from '@/components/reui/filters/filters-query';
import { Filters, FiltersRow } from '@/components/reui/filters/filters';
import type { FilterField, FilterOperator, FilterQuery } from '@/components/reui/filters/filters-types';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { filterLabels } from '@/components/live/live-filter-bar';
import { ExplainEmpty, SettingsSection } from '@/components/settings';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { sortByLabel } from '@/lib/alphabetical';
import type { CosmosStatementData } from '@/lib/cosmos/data';
import { olderCosmosEntries } from '@/lib/cosmos/statement-actions';
import { initials } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';

import { PeriodPicker } from './period-picker';
import { formatPrice } from './purchase-dialog';
import { UsageChart } from './usage-chart';

type Entry = CosmosStatementData['entries'][number];
type Person = Entry['person'];

const FILTER_OPERATOR = 'is_any_of';
const FILTER_FIELDS = ['kind', 'fn', 'scope'] as const;
type FilterKey = (typeof FILTER_FIELDS)[number];

function PersonCell({ person, fallback }: { person: Person; fallback: string }) {
  if (!person) return <span className="text-muted-foreground text-sm">{fallback}</span>;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="size-7">
        {person.image ? <AvatarImage src={person.image} alt="" /> : null}
        <AvatarFallback className="text-xs">{initials(person.name || person.email)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">{person.name || person.email}</span>
    </div>
  );
}

/** Lê e escreve os filtros e o período na URL (a página renderiza de novo no servidor). */
function useStatementUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const go = (change: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(search.toString());
    change(p);
    p.set('tab', 'usage');
    p.delete('cursor');
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return { search, go };
}

function StatementFilters({ data }: { data: CosmosStatementData }) {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  const { search, go } = useStatementUrl();
  const fromUrl = (): FilterQuery =>
    createFilterQuery(
      FILTER_FIELDS.flatMap((f) => {
        const values = search.getAll(f);
        return values.length
          ? [createFilterRule<unknown>({ id: f, path: [f], operator: FILTER_OPERATOR, value: values })]
          : [];
      }),
    );
  const key = FILTER_FIELDS.map((f) => search.getAll(f).join(',')).join('|');
  const [state, setState] = useState(() => ({ key, query: fromUrl() }));
  let query = state.query;
  if (state.key !== key) {
    query = fromUrl();
    setState({ key, query });
  }

  const inUse = new Set(query.rules.flatMap((r) => (r.type === 'rule' ? r.path : [])));
  const operators: FilterOperator[] = [{ value: FILTER_OPERATOR, label: T.filters.operator, arity: 'many' }];
  const base = (id: FilterKey, label: string) =>
    ({
      id,
      label,
      type: 'select',
      operators,
      defaultOperator: FILTER_OPERATOR,
      disabled: inUse.has(id),
    }) satisfies Partial<FilterField>;
  const fields: FilterField[] = [
    {
      ...base('kind', T.filters.kind),
      icon: <ListFilter aria-hidden />,
      searchable: false,
      options: sortByLabel(Object.entries(T.kinds).map(([value, label]) => ({ value, label }))),
    },
    {
      ...base('fn', T.filters.function),
      icon: <FunctionSquare aria-hidden />,
      options: sortByLabel(data.functions.map((f) => ({ value: f, label: f }))),
    },
    {
      ...base('scope', T.filters.scope),
      icon: <Layers aria-hidden />,
      options: sortByLabel(data.scopes.map((s) => ({ value: s, label: s }))),
    },
  ];

  const onQueryChange = (changed: FilterQuery) => {
    const next = {
      ...changed,
      rules: changed.rules.map((r) =>
        r.type === 'rule' && !r.operator ? { ...r, operator: FILTER_OPERATOR } : r,
      ),
    };
    const values: Record<FilterKey, string[]> = { kind: [], fn: [], scope: [] };
    for (const rule of flattenFilterRules(next)) {
      const field = rule.path[0] as FilterKey | undefined;
      if (!field || !FILTER_FIELDS.includes(field)) continue;
      const raw = Array.isArray(rule.value) ? (rule.value as unknown[]) : [rule.value];
      values[field] = raw.filter((v): v is string => typeof v === 'string' && v !== '');
    }
    const nextKey = FILTER_FIELDS.map((f) => values[f].join(',')).join('|');
    setState({ key: nextKey, query: next });
    if (nextKey !== key)
      go((p) => {
        for (const f of FILTER_FIELDS) {
          p.delete(f);
          for (const v of values[f]) p.append(f, v);
        }
      });
  };

  return (
    <div role="search" aria-label={T.filters.label} className="min-w-0">
      <Filters
        fields={fields}
        query={query}
        onQueryChange={onQueryChange}
        labels={filterLabels(locale, t.live.filters.ui)}
        size="sm"
      >
        <FiltersRow showClear />
      </Filters>
    </div>
  );
}

function useColumns(timeZone: string): ColumnDef<DataGridFeatures, Entry>[] {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  const c = T.columns;
  return useMemo(() => {
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone });
    return [
      {
        id: 'date',
        accessorFn: (e) => new Date(e.createdAt).getTime(),
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.date} />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{when.format(new Date(row.original.createdAt))}</span>
        ),
        size: 150,
      },
      {
        id: 'kind',
        accessorFn: (e) => e.kind,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.kind} />,
        cell: ({ row }) => (
          <Badge variant={row.original.credits >= 0 ? 'success-light' : 'secondary'}>
            {T.kinds[row.original.kind]}
          </Badge>
        ),
        size: 130,
      },
      {
        id: 'scope',
        accessorFn: (e) => e.scope ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.scope} />,
        cell: ({ row }) => <span className="truncate text-sm">{row.original.scope ?? T.none}</span>,
        size: 150,
      },
      {
        id: 'function',
        accessorFn: (e) => e.functionName ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.function} />,
        cell: ({ row }) => <code className="truncate text-xs">{row.original.functionName ?? T.none}</code>,
        size: 160,
      },
      {
        id: 'user',
        accessorFn: (e) => e.person?.name ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.user} />,
        cell: ({ row }) => <PersonCell person={row.original.person} fallback={T.system} />,
        size: 180,
      },
      {
        id: 'credits',
        accessorFn: (e) => e.credits,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.credits} />,
        cell: ({ row }) => (
          <span className="text-sm font-medium tabular-nums">
            {row.original.credits > 0 ? '+' : ''}
            {n.format(row.original.credits)}
          </span>
        ),
        size: 110,
      },
      {
        id: 'balance',
        accessorFn: (e) => e.balanceAfter,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.balance} />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{n.format(row.original.balanceAfter)}</span>
        ),
        size: 120,
      },
    ];
  }, [T, c, locale, timeZone]);
}

function StatementGrid({ data, timeZone }: { data: CosmosStatementData; timeZone: string }) {
  const { t } = useI18n();
  const T = t.cosmos.usage;
  const grid = t.admin.table.grid;
  const columns = useColumns(timeZone);
  const { search } = useStatementUrl();
  const filtered = ['kind', 'fn', 'scope'].some((f) => search.getAll(f).length);
  // "Mostrar mais antigos" acumula as páginas na tela (a URL segue com o período e os filtros); outro período ou
  // filtro recomeça da primeira página
  const key = `${search.toString()}|${data.entries[0]?.id ?? ''}`;
  const [more, setMore] = useState<{
    key: string;
    entries: CosmosStatementData['entries'];
    cursor: string | null;
  }>({ key, entries: [], cursor: data.nextCursor });
  const current = more.key === key ? more : { key, entries: [], cursor: data.nextCursor };
  const entries = useMemo(() => [...data.entries, ...current.entries], [data.entries, current.entries]);
  const [loading, startLoading] = useTransition();
  const table = useTable({
    features: dataGridFeatures,
    data: entries,
    columns,
    getRowId: (e) => e.id,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });
  const older = () => {
    if (!current.cursor) return;
    const cursor = current.cursor;
    startLoading(async () => {
      const page = await olderCosmosEntries({
        from: search.get('from') ?? undefined,
        to: search.get('to') ?? undefined,
        kind: search.getAll('kind'),
        fn: search.getAll('fn'),
        scope: search.getAll('scope'),
        cursor,
      });
      if (!page) return;
      setMore({ key, entries: [...current.entries, ...page.entries], cursor: page.nextCursor });
    });
  };

  if (!data.entries.length && !filtered)
    return (
      <ExplainEmpty title={T.emptyTitle} description={T.emptyDescription} className="rounded-xl border" />
    );

  return (
    <DataGrid
      table={table}
      recordCount={entries.length}
      emptyMessage={T.filteredEmpty}
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
      {current.cursor ? (
        <div className="px-4 py-3">
          <Button variant="outline" size="sm" onClick={older} disabled={loading}>
            {T.more}
          </Button>
        </div>
      ) : null}
    </DataGrid>
  );
}

function UsageTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: React.ReactNode; credits: number; calls: number }[];
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  return (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>{title}</FrameTitle>
        </FrameHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{title}</TableHead>
              <TableHead className="text-right">{T.credits}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="max-w-0">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{n.format(r.credits)}</span>
                      <span className="text-muted-foreground text-xs">
                        {plural(locale, r.calls, T.calls)}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground text-sm">
                  {T.chartEmpty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </FramePanel>
    </Frame>
  );
}

function Purchases({ data, timeZone }: { data: CosmosStatementData; timeZone: string }) {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  const n = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });
  return (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>{T.purchasesTitle}</FrameTitle>
          <FrameDescription>{T.purchasesDescription}</FrameDescription>
        </FrameHeader>
        {data.purchases.length ? (
          <Table>
            <TableBody>
              {data.purchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {fill(t.cosmos.purchase.summary, {
                          credits: n.format(p.credits),
                          price: formatPrice(locale, p.amountCents, p.currency),
                        })}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {when.format(new Date(p.createdAt))}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant={
                          p.status === 'paid'
                            ? 'success-light'
                            : p.status === 'pending'
                              ? 'warning-light'
                              : 'secondary'
                        }
                      >
                        {T.status[p.status]}
                      </Badge>
                      {p.status === 'paid' && p.hasReceipt ? (
                        <span className="text-muted-foreground text-xs">{T.receipt}</span>
                      ) : null}
                      {p.auto ? (
                        <span className="text-muted-foreground text-xs">{T.autoRecharge}</span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground px-4 pb-4 text-sm">{T.purchasesEmpty}</p>
        )}
      </FramePanel>
    </Frame>
  );
}

/**
 * Uso e extrato (#995): o consumo por dia, o extrato com filtros e CSV, o uso por pessoa e por função e as
 * compras. O cliente nunca vê tokens nem custo técnico (a página só recebe a visão do cliente).
 */
export function CosmosUsage({ data, timeZone }: { data: CosmosStatementData; timeZone: string }) {
  const { t } = useI18n();
  const T = t.cosmos.usage;
  const { search, go } = useStatementUrl();
  const csv = new URLSearchParams();
  for (const k of ['from', 'to', 'kind', 'fn', 'scope']) for (const v of search.getAll(k)) csv.append(k, v);
  if (!csv.get('from')) {
    csv.set('from', data.period.from);
    csv.set('to', data.period.to);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PeriodPicker
          period={data.period}
          onApply={(p) =>
            go((q) => {
              q.set('from', p.from);
              q.set('to', p.to);
            })
          }
        />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={`/api/cliente/cosmos/extrato?${csv.toString()}`} download />}
        >
          <Download aria-hidden />
          {T.export}
        </Button>
      </div>

      <UsageChart
        title={T.chartTitle}
        description={T.chartDescription}
        data={data.daily}
        empty={T.chartEmpty}
      />

      <SettingsSection title={T.statementTitle} description={T.statementDescription}>
        <StatementFilters data={data} />
        <StatementGrid data={data} timeZone={timeZone} />
      </SettingsSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <UsageTable
          title={T.byUserTitle}
          rows={data.byUser.map((u) => ({
            key: u.key ?? 'system',
            label: <PersonCell person={u.person} fallback={T.system} />,
            credits: u.credits,
            calls: u.calls,
          }))}
        />
        <UsageTable
          title={T.byFunctionTitle}
          rows={data.byFunction.map((f) => ({
            key: f.key ?? 'none',
            label: <code className="truncate text-xs">{f.key ?? T.none}</code>,
            credits: f.credits,
            calls: f.calls,
          }))}
        />
      </div>

      <Purchases data={data} timeZone={timeZone} />
    </div>
  );
}
