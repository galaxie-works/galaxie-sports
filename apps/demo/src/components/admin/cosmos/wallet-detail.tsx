'use client';

import { type ColumnDef, useTable } from '@tanstack/react-table';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';

import { creditWallet, setBlocked, setMultiplier } from '@/app/[locale]/(app)/ajustes/carteiras/actions';
import { Badge } from '@/components/reui/badge';
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import { SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { StaffWalletDetail } from '@/lib/cosmos/staff-data';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { ReasonDialog } from './reason-dialog';
import { walletState } from './wallets-table';

type Entry = StaffWalletDetail['entries'][number];

function AmountAction({
  kind,
  tenantId,
}: {
  kind: 'adjustment' | 'refund' | 'multiplier';
  tenantId: string;
}) {
  const { t } = useI18n();
  const T = t.cosmosStaff.actions;
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState('');
  const n = Number(value);
  const valid = Number.isFinite(n) && n !== 0 && (kind === 'adjustment' || n > 0);
  const title = kind === 'adjustment' ? T.adjust : kind === 'refund' ? T.refund : T.multiplier;
  const description =
    kind === 'adjustment'
      ? T.adjustDescription
      : kind === 'refund'
        ? T.refundDescription
        : T.multiplierDescription;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm">
          {title}
        </Button>
      }
      title={title}
      description={description}
      canConfirm={valid}
      onConfirm={async (reason) => {
        const r =
          kind === 'multiplier'
            ? await setMultiplier({ tenantId, multiplier: n, reason })
            : await creditWallet({ tenantId, kind, credits: n, reason });
        if (r.ok) {
          setValue('');
          router.refresh();
        }
        return r;
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-value`}>
          {kind === 'multiplier' ? T.multiplierLabel : T.credits}
        </FieldLabel>
        <Input
          id={`${id}-value`}
          type="number"
          step={kind === 'multiplier' ? 0.1 : 1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </ReasonDialog>
  );
}

function BlockAction({ tenantId, blocked }: { tenantId: string; blocked: boolean }) {
  const { t } = useI18n();
  const T = t.cosmosStaff.actions;
  const router = useRouter();
  return (
    <ReasonDialog
      trigger={
        <Button variant={blocked ? 'outline' : 'destructive'} size="sm">
          {blocked ? T.unblock : T.block}
        </Button>
      }
      title={blocked ? T.unblock : T.block}
      description={blocked ? T.unblockDescription : T.blockDescription}
      onConfirm={async (reason) => {
        const r = await setBlocked({ tenantId, blocked: !blocked, reason });
        if (r.ok) router.refresh();
        return r;
      }}
    />
  );
}

function useLedgerColumns(timeZone: string): ColumnDef<DataGridFeatures, Entry>[] {
  const { t, locale } = useI18n();
  const T = t.cosmosStaff.ledger;
  const kinds = t.cosmos.usage.kinds;
  return useMemo(() => {
    const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    const usd = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 6,
    });
    const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone });
    return [
      {
        id: 'date',
        accessorFn: (e) => new Date(e.createdAt).getTime(),
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.date} />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{when.format(new Date(row.original.createdAt))}</span>
        ),
        size: 140,
      },
      {
        id: 'kind',
        accessorFn: (e) => e.kind,
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.kind} />,
        cell: ({ row }) => <Badge variant="secondary">{kinds[row.original.kind]}</Badge>,
        size: 120,
      },
      {
        id: 'credits',
        accessorFn: (e) => e.credits,
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.credits} />,
        cell: ({ row }) => <span className="tabular-nums">{n.format(row.original.credits)}</span>,
        size: 100,
      },
      {
        id: 'balance',
        accessorFn: (e) => e.balanceAfter,
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.balance} />,
        cell: ({ row }) => <span className="tabular-nums">{n.format(row.original.balanceAfter)}</span>,
        size: 110,
      },
      {
        id: 'function',
        accessorFn: (e) => e.functionName ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.function} />,
        cell: ({ row }) => <code className="text-xs">{row.original.functionName ?? '—'}</code>,
        size: 150,
      },
      {
        id: 'scope',
        accessorFn: (e) => e.scope ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.scope} />,
        cell: ({ row }) => <span className="text-sm">{row.original.scope ?? '—'}</span>,
        size: 140,
      },
      {
        id: 'tokens',
        accessorFn: (e) => e.tokensIn ?? 0,
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.tokens} />,
        cell: ({ row }) => {
          const e = row.original;
          return e.tokensIn === null && e.tokensOut === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="text-sm tabular-nums">
              {[e.tokensIn, e.tokensCached, e.tokensOut].map((v) => n.format(v ?? 0)).join(' · ')}
            </span>
          );
        },
        size: 190,
      },
      {
        id: 'cost',
        accessorFn: (e) => e.costUsd ?? 0,
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.cost} />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.costUsd === null ? '—' : usd.format(row.original.costUsd)}
          </span>
        ),
        size: 110,
      },
      {
        id: 'model',
        accessorFn: (e) => e.model ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.model} />,
        cell: ({ row }) => <code className="text-xs">{row.original.model ?? '—'}</code>,
        size: 140,
      },
      {
        id: 'who',
        accessorFn: (e) => e.person?.name ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.who} />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.person?.name ?? row.original.userId ?? '—'}</span>
        ),
        size: 150,
      },
      {
        id: 'note',
        accessorFn: (e) => e.note ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={T.note} />,
        cell: ({ row }) => <span className="text-sm">{row.original.note ?? '—'}</span>,
        size: 220,
      },
    ];
  }, [T, kinds, locale, timeZone]);
}

/**
 * Detalhe de uma carteira para a equipe Galaxie (#1002): o resumo com o multiplicador, as ações com motivo, o
 * extrato completo (tokens, custo real, modelo), as ações já feitas e os pacotes do mercado do cliente.
 */
export function WalletDetail({ data, timeZone }: { data: StaffWalletDetail; timeZone: string }) {
  const { t, locale } = useI18n();
  const T = t.cosmosStaff;
  const grid = t.admin.table.grid;
  const router = useRouter();
  const pathname = usePathname();
  const columns = useLedgerColumns(timeZone);
  const table = useTable({
    features: dataGridFeatures,
    data: data.entries,
    columns,
    getRowId: (e) => e.id,
    initialState: { pagination: { pageIndex: 0, pageSize: 100 } },
  });
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone });
  const w = data.wallet;
  const state = walletState({ enabled: w.enabled, status: w.status, blockReason: w.blockReason });
  const stats: [string, string][] = [
    [T.detail.available, n.format(w.available)],
    [T.detail.reserved, n.format(w.reserved)],
    [T.detail.received, n.format(w.receivedTotal)],
    [T.detail.trial, n.format(w.trialRemaining)],
    [T.detail.multiplier, `×${n.format(w.multiplier)}`],
  ];
  const price = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(
      cents / 100,
    );
  const change = (before: unknown, after: unknown) =>
    `${JSON.stringify(before ?? {})} → ${JSON.stringify(after ?? {})}`.replace(/[{}"]/g, '');

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={`${T.detail.summaryTitle} · ${data.tenant.name}`}
        description={data.tenant.slug}
        action={<Badge variant="secondary">{T.status[state]}</Badge>}
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>

      <SettingsSection title={T.detail.actionsTitle} description={T.detail.actionsDescription}>
        <div className="flex flex-wrap gap-2">
          <AmountAction kind="adjustment" tenantId={data.tenant.tenantId} />
          <AmountAction kind="refund" tenantId={data.tenant.tenantId} />
          <AmountAction kind="multiplier" tenantId={data.tenant.tenantId} />
          <BlockAction
            tenantId={data.tenant.tenantId}
            blocked={w.status === 'blocked' && w.blockReason === 'staff'}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={T.detail.ledgerTitle} description={T.detail.ledgerDescription}>
        <DataGrid
          table={table}
          recordCount={data.entries.length}
          emptyMessage={t.cosmos.usage.emptyDescription}
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
              empty: t.cosmos.usage.emptyDescription,
            },
          }}
        >
          <DataGridContainer>
            <DataGridTable />
          </DataGridContainer>
        </DataGrid>
        {data.nextCursor ? (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.replace(`${pathname}?cursor=${data.nextCursor}`, { scroll: false })}
            >
              {T.detail.more}
            </Button>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={T.detail.historyTitle}>
        {data.actions.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.history.when}</TableHead>
                <TableHead>{T.history.action}</TableHead>
                <TableHead>{T.history.change}</TableHead>
                <TableHead>{T.history.reason}</TableHead>
                <TableHead>{T.history.who}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm tabular-nums">{when.format(new Date(a.createdAt))}</TableCell>
                  <TableCell>{T.history.kinds[a.action]}</TableCell>
                  <TableCell className="text-xs">{change(a.before, a.after)}</TableCell>
                  <TableCell className="text-sm">{a.reason}</TableCell>
                  <TableCell className="text-sm">{a.person?.name ?? a.userId}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">{T.detail.historyEmpty}</p>
        )}
      </SettingsSection>

      {data.review.length ? (
        <SettingsSection title={T.detail.reviewTitle} description={T.detail.reviewDescription}>
          <ul className="flex flex-col gap-1 text-sm">
            {data.review.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 rounded-md border px-3 py-2">
                <span className="tabular-nums">{when.format(new Date(p.createdAt))}</span>
                <span className="tabular-nums">
                  {fill(t.cosmos.purchase.summary, {
                    credits: n.format(p.credits),
                    price: price(p.amountCents, p.currency),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <SettingsSection title={T.detail.packagesTitle}>
        {data.packages.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {data.packages.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 rounded-md border px-3 py-2">
                <span>{p.name}</span>
                <span className="tabular-nums">
                  {fill(t.cosmos.purchase.summary, {
                    credits: n.format(p.credits),
                    price: price(p.priceCents, p.currency),
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{T.detail.packagesEmpty}</p>
        )}
      </SettingsSection>
    </div>
  );
}
