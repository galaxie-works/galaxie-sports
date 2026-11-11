'use client';

import type { TenantRole } from '@galaxie/engage';
import { useRouter } from 'next/navigation';
import { Fragment, useTransition } from 'react';
import { toast } from 'sonner';

import { changeRolePermission, resetPermissions } from '@/app/[locale]/(app)/cliente/usuarios/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { SafetyNote, SettingsSection } from '@/components/settings';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PermissionGroup, PermissionRow } from '@/lib/client/permission-matrix';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const GROUPS: PermissionGroup[] = ['account', 'moderation', 'cosmos'];

function ResetButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const p = t.client.members.permissions;
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={disabled || pending} />}>
        {pending ? <Spinner /> : null}
        {p.reset}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p.resetTitle}</AlertDialogTitle>
          <AlertDialogDescription>{p.resetBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.client.members.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const res = await resetPermissions();
                if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
                toast.success(p.resetDone);
                router.refresh();
              })
            }
          >
            {p.reset}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Permissões por cargo (Usuários e cargos): uma linha por ação, uma coluna por cargo. O Dono marca e desmarca; o
 * servidor aplica a Escada (dar sobe, tirar desce), grava na auditoria e a tela recarrega com o efetivo. Quem não é
 * Dono vê a mesma tabela, só leitura.
 */
export function RolePermissionsPanel({
  rows,
  editable,
  customized,
}: {
  rows: PermissionRow[];
  editable: boolean;
  /** O tenant mudou alguma permissão da matriz padrão. */
  customized: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const p = m.permissions;
  const [pending, startTransition] = useTransition();
  const roles = rows[0]?.cells.map((c) => c.role) ?? [];

  const toggle = (row: PermissionRow, role: TenantRole, allowed: boolean) =>
    startTransition(async () => {
      const res = await changeRolePermission({ role, action: row.action, allowed });
      if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
      toast.success(fill(p.saved, { role: m.roles[role] }));
      router.refresh();
    });

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          {p.title}
          {customized ? (
            <Badge variant="info-light" size="sm">
              {p.custom}
            </Badge>
          ) : null}
        </span>
      }
      description={p.description}
      action={editable ? <ResetButton disabled={!customized} /> : null}
    >
      {!editable ? <SafetyNote>{p.readOnly}</SafetyNote> : null}
      <Frame>
        <FramePanel className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{p.action}</TableHead>
                {roles.map((role) => (
                  <TableHead key={role} className="text-center">
                    {m.roles[role]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {GROUPS.map((group) => {
                const items = rows.filter((r) => r.group === group);
                if (!items.length) return null;
                return (
                  <Fragment key={group}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={roles.length + 1} className="text-xs font-semibold uppercase">
                        {p.groups[group]}
                      </TableCell>
                    </TableRow>
                    {items.map((row) => {
                      const label = p.labels[row.action];
                      return (
                        <TableRow key={row.action}>
                          <TableCell className="text-sm whitespace-normal">
                            <span className="flex flex-wrap items-center gap-2">
                              {label}
                              {row.fixed ? (
                                <Badge variant="secondary" size="sm">
                                  {p.fixed}
                                </Badge>
                              ) : null}
                            </span>
                          </TableCell>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.role} className="text-center">
                              <Checkbox
                                checked={cell.allowed}
                                disabled={!cell.editable || pending}
                                aria-label={fill(p.toggle, { action: label, role: m.roles[cell.role] })}
                                onCheckedChange={(v) => toggle(row, cell.role, v === true)}
                                className="mx-auto"
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>
      <SafetyNote>{p.ownerNote}</SafetyNote>
      <SafetyNote>{p.volunteerNote}</SafetyNote>
    </SettingsSection>
  );
}
