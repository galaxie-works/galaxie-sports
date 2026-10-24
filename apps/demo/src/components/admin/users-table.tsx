'use client';

import { type ColumnDef, useTable } from '@tanstack/react-table';
import { MoreHorizontal, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { resendInvite, setDisabled } from '@/app/[locale]/(app)/ajustes/actions';
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridPagination } from '@/components/reui/data-grid/data-grid-pagination';
import { DataGridTable } from '@/components/reui/data-grid/data-grid-table';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DemoUser, UserStatus } from '@/lib/auth/admin';
import type { TenantOption } from '@/lib/client/tenants';
import { initials } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';

import { InviteDialog } from './invite-dialog';
import { RoleBadge, StatusBadge, useAdminFormat } from './user-badges';

const STATUSES: UserStatus[] = ['active', 'pending', 'expired', 'disabled'];

function RowActions({ user }: { user: DemoUser }) {
  const router = useRouter();
  const { t } = useI18n();
  const [, startTransition] = useTransition();
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; emailSent?: boolean; link?: string | null }>,
    ok: string,
  ) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? t.admin.feedback.failed);
      if (res.emailSent === false && res.link) {
        void navigator.clipboard.writeText(res.link);
        toast.warning(t.admin.feedback.emailNotSent);
      } else toast.success(ok);
      router.refresh();
    });

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={fill(t.admin.table.rowActions, { name: user.name })}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onClick={() => router.push(`/ajustes/usuarios/${user.id}`)}>
            {t.admin.table.viewDetails}
          </DropdownMenuItem>
          {user.status === 'pending' ? (
            <DropdownMenuItem onClick={() => run(() => resendInvite(user.id), t.admin.table.inviteResent)}>
              {t.admin.table.resendInvite}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {user.status === 'disabled' ? (
            <DropdownMenuItem
              onClick={() => run(() => setDisabled(user.id, false), t.admin.table.reactivated)}
            >
              {t.admin.table.reactivate}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => run(() => setDisabled(user.id, true), t.admin.table.deactivated)}
            >
              {t.admin.table.deactivate}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Colunas da tabela no idioma da tela (datas no fuso de quem vê). */
function useColumns(timeZone: string): ColumnDef<DataGridFeatures, DemoUser>[] {
  const { locale, t } = useI18n();
  const { accessLabel, relativeTime } = useAdminFormat(timeZone);
  const c = t.admin.table.columns;
  return useMemo(
    () => [
      {
        id: 'name',
        accessorFn: (u) => u.name,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.user} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{row.original.name}</span>
              <span className="text-muted-foreground truncate text-xs">{row.original.email}</span>
            </div>
          </div>
        ),
        size: 280,
      },
      {
        id: 'company',
        accessorFn: (u) => u.company ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.companyJob} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate">{row.original.company ?? t.common.none}</span>
            <span className="text-muted-foreground truncate text-xs">{row.original.jobTitle ?? ''}</span>
          </div>
        ),
        size: 220,
      },
      {
        id: 'role',
        accessorFn: (u) => u.role,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.role} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <RoleBadge role={row.original.role} />
            {row.original.tenant ? (
              <span className="text-muted-foreground max-w-full truncate text-xs">
                {row.original.tenant.name ?? t.admin.tenant.missing}
              </span>
            ) : null}
          </div>
        ),
        size: 140,
      },
      {
        id: 'status',
        accessorFn: (u) => u.status,
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.status} />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        size: 170,
      },
      {
        id: 'access',
        accessorFn: (u) => u.accessExpiresAt ?? '9999',
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.access} />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {accessLabel(row.original.role, row.original.accessExpiresAt)}
          </span>
        ),
        size: 140,
      },
      {
        id: 'lastLogin',
        accessorFn: (u) => u.lastLoginAt ?? '',
        header: ({ column }) => <DataGridColumnHeader column={column} title={c.lastLogin} />,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm">
              {row.original.lastLoginAt
                ? relativeTime(row.original.lastLoginAt)
                : row.original.status === 'pending'
                  ? t.admin.table.inviteSent
                  : t.admin.table.never}
            </span>
            {row.original.pageViews ? (
              <span className="text-muted-foreground text-xs">
                {plural(locale, row.original.pageViews, t.admin.table.pageViews)}
              </span>
            ) : null}
          </div>
        ),
        size: 160,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => <RowActions user={row.original} />,
        enableSorting: false,
        size: 56,
      },
    ],
    [locale, t, c, accessLabel, relativeTime],
  );
}

export function UsersTable({
  users,
  tenants,
  operatorDomains = {},
  timeZone,
}: {
  users: DemoUser[];
  tenants: TenantOption[];
  /** Domínios de e-mail da operadora de cada tenant (aviso no convite de cliente). */
  operatorDomains?: Record<string, string[]>;
  timeZone: string;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const columns = useColumns(timeZone);
  const grid = t.admin.table.grid;
  const roleFilter = [
    { value: 'all', label: t.admin.table.allRoles },
    { value: 'admin', label: t.admin.roles.admin },
    { value: 'user', label: t.admin.roles.user },
    { value: 'client', label: t.admin.roles.client },
  ];
  const statusFilter = [
    { value: 'all', label: t.admin.table.allStatuses },
    ...STATUSES.map((s) => ({ value: s, label: t.admin.status[s] })),
  ];
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState<UserStatus | 'all'>('all');

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (role === 'all' || u.role === role) &&
        (status === 'all' || u.status === status) &&
        (!q || [u.name, u.email, u.company, u.jobTitle].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [users, query, role, status]);

  const table = useTable({
    features: dataGridFeatures,
    data,
    columns,
    getRowId: (u) => u.id,
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  const pending = users.filter((u) => u.status === 'pending').length;

  return (
    <Frame>
      <FramePanel>
        <FrameHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <FrameTitle>{t.admin.table.title}</FrameTitle>
            <FrameDescription>
              {plural(locale, users.length, t.admin.table.people)} ·{' '}
              {plural(locale, pending, t.admin.table.pendingInvites)}
            </FrameDescription>
          </div>
          <InviteDialog tenants={tenants} operatorDomains={operatorDomains} />
        </FrameHeader>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t.admin.table.search}
              aria-label={t.admin.table.searchLabel}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          <Select items={roleFilter} value={role} onValueChange={(v) => setRole(String(v))}>
            <SelectTrigger className="w-40" aria-label={t.admin.table.roleFilter}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleFilter.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={statusFilter}
            value={status}
            onValueChange={(v) => setStatus(v as UserStatus | 'all')}
          >
            <SelectTrigger className="w-44" aria-label={t.admin.table.statusFilter}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusFilter.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataGrid
          table={table}
          recordCount={data.length}
          emptyMessage={t.admin.table.empty}
          onRowClick={(u) => router.push(`/ajustes/usuarios/${u.id}`)}
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
              empty: t.admin.table.empty,
            },
          }}
        >
          <DataGridContainer>
            <DataGridTable />
          </DataGridContainer>
          <div className="px-4 py-3">
            <DataGridPagination sizes={[10, 25, 50]} />
          </div>
        </DataGrid>
      </FramePanel>
    </Frame>
  );
}
