'use client';

import { type ColumnDef, useTable } from '@tanstack/react-table';
import { MoreHorizontal, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { resendInvite, setDisabled } from '@/app/(app)/ajustes/actions';
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
import { initials } from '@/lib/format';

import { InviteDialog } from './invite-dialog';
import { accessLabel, relativeTime, RoleBadge, StatusBadge } from './user-badges';

const ROLE_FILTER = [
  { value: 'all', label: 'Todos os papéis' },
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'Convidado' },
];
const STATUS_FILTER = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'pending', label: 'Convite pendente' },
  { value: 'expired', label: 'Expirado' },
  { value: 'disabled', label: 'Desativado' },
];

function RowActions({ user }: { user: DemoUser }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; emailSent?: boolean; link?: string | null }>,
    ok: string,
  ) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? 'Não foi possível concluir.');
      if (res.emailSent === false && res.link) {
        void navigator.clipboard.writeText(res.link);
        toast.warning('E-mail não enviado: link do convite copiado para colar em outro canal.');
      } else toast.success(ok);
      router.refresh();
    });

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${user.name}`} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onClick={() => router.push(`/ajustes/usuarios/${user.id}`)}>
            Ver detalhes
          </DropdownMenuItem>
          {user.status === 'pending' ? (
            <DropdownMenuItem onClick={() => run(() => resendInvite(user.id), 'Convite reenviado')}>
              Reenviar convite
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {user.status === 'disabled' ? (
            <DropdownMenuItem onClick={() => run(() => setDisabled(user.id, false), 'Acesso reativado')}>
              Reativar acesso
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => run(() => setDisabled(user.id, true), 'Acesso desativado')}
            >
              Desativar acesso
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const columns: ColumnDef<DataGridFeatures, DemoUser>[] = [
  {
    id: 'name',
    accessorFn: (u) => u.name,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Usuário" />,
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
    header: ({ column }) => <DataGridColumnHeader column={column} title="Empresa e cargo" />,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{row.original.company ?? '—'}</span>
        <span className="text-muted-foreground truncate text-xs">{row.original.jobTitle ?? ''}</span>
      </div>
    ),
    size: 220,
  },
  {
    id: 'role',
    accessorFn: (u) => u.role,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Papel" />,
    cell: ({ row }) => <RoleBadge role={row.original.role} />,
    size: 120,
  },
  {
    id: 'status',
    accessorFn: (u) => u.status,
    header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    size: 170,
  },
  {
    id: 'access',
    accessorFn: (u) => u.accessExpiresAt ?? '9999',
    header: ({ column }) => <DataGridColumnHeader column={column} title="Acesso" />,
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
    header: ({ column }) => <DataGridColumnHeader column={column} title="Último acesso" />,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-sm">
          {row.original.lastLoginAt
            ? relativeTime(row.original.lastLoginAt)
            : row.original.status === 'pending'
              ? 'Convite enviado'
              : 'Nunca'}
        </span>
        {row.original.pageViews ? (
          <span className="text-muted-foreground text-xs">{row.original.pageViews} páginas vistas</span>
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
];

export function UsersTable({ users }: { users: DemoUser[] }) {
  const router = useRouter();
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
            <FrameTitle>Usuários</FrameTitle>
            <FrameDescription>
              {users.length} {users.length === 1 ? 'pessoa' : 'pessoas'} · {pending}{' '}
              {pending === 1 ? 'convite pendente' : 'convites pendentes'}
            </FrameDescription>
          </div>
          <InviteDialog />
        </FrameHeader>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Buscar por nome, e-mail ou empresa"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          <Select items={ROLE_FILTER} value={role} onValueChange={(v) => setRole(String(v))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTER.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={STATUS_FILTER}
            value={status}
            onValueChange={(v) => setStatus(v as UserStatus | 'all')}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER.map((s) => (
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
          emptyMessage="Nenhum usuário encontrado."
          onRowClick={(u) => router.push(`/ajustes/usuarios/${u.id}`)}
          tableLayout={{ headerBackground: true }}
          i18n={{
            labels: {
              rowsPerPage: 'Linhas por página',
              paginationInfo: ({ from, to, count }) => `${from}–${to} de ${count}`,
              sortAscending: 'Crescente',
              sortDescending: 'Decrescente',
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
