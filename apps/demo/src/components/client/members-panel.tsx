'use client';

import type { TenantRole } from '@galaxie/engage';
import { Plus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

import { changeMemberRole, inviteMember, removeMember } from '@/app/[locale]/(app)/cliente/usuarios/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { MemberEvent } from '@/lib/client/members';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface MemberRow {
  memberId: string;
  email: string;
  name: string;
  role: TenantRole;
  /** null = tenant inteiro; número = quantas Comunidades e Salas. */
  scopeCount: number | null;
  pending: boolean;
  createdAt: string;
  self: boolean;
  /** Cargos que quem vê pode dar a esta pessoa; vazio = não troca. */
  assignable: TenantRole[];
  removable: boolean;
}

function InviteDialog({ roles }: { roles: TenantRole[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<TenantRole>(roles[roles.length - 1] ?? 'moderator');
  const [pending, startTransition] = useTransition();
  const items = roles.map((r) => ({ value: r, label: m.roles[r] }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus aria-hidden />
        {m.invite}
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await inviteMember({ email, name, role });
              if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
              toast.success(fill(m.invited, { email }));
              if (res.link) toast.info(fill(m.inviteLink, { link: res.link }), { duration: 30_000 });
              setOpen(false);
              setEmail('');
              setName('');
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.inviteTitle}</DialogTitle>
            <DialogDescription>{m.inviteDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="member-name">{m.name}</FieldLabel>
              <Input
                id="member-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-email">{m.email}</FieldLabel>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel>{m.role}</FieldLabel>
              <Select items={items} value={role} onValueChange={(v) => v && setRole(v as TenantRole)}>
                <SelectTrigger aria-label={m.role}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{m.roleHelp[role]}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {m.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleCell({ row }: { row: MemberRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const [pending, startTransition] = useTransition();
  if (!row.assignable.length) return <Badge variant="secondary">{m.roles[row.role]}</Badge>;
  const options = row.assignable.includes(row.role) ? row.assignable : [row.role, ...row.assignable];
  const items = options.map((r) => ({ value: r, label: m.roles[r] }));
  return (
    <Select
      items={items}
      value={row.role}
      disabled={pending}
      onValueChange={(v) =>
        v &&
        v !== row.role &&
        startTransition(async () => {
          const res = await changeMemberRole({ memberId: row.memberId, role: String(v) });
          if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
          toast.success(m.changed);
          router.refresh();
        })
      }
    >
      <SelectTrigger className="w-44" aria-label={`${m.role} · ${row.email}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RemoveButton({ row }: { row: MemberRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        {pending ? <Spinner /> : null}
        {m.remove}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(m.removeTitle, { email: row.email })}</AlertDialogTitle>
          <AlertDialogDescription>{m.removeBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const res = await removeMember({ memberId: row.memberId });
                if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
                toast.success(m.removed);
                router.refresh();
              })
            }
          >
            {m.remove}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Cliente → Conta → Usuários e cargos (#1019): equipe, cargos, convite e auditoria. */
export function MembersPanel({
  members,
  invitable,
  events,
  timeZone,
  permissions,
}: {
  members: MemberRow[];
  /** Cargos que quem vê pode dar num convite; vazio = só leitura. */
  invitable: TenantRole[];
  events: MemberEvent[];
  timeZone: string;
  /** Permissões por cargo, entre a equipe e a auditoria. */
  permissions?: ReactNode;
}) {
  const { t } = useI18n();
  const m = t.client.members;
  const fmt = useFormatters(timeZone);
  const manage = invitable.length > 0;
  const who = (actor: string) =>
    actor === 'legacy' ? m.audit.legacy : actor.startsWith('galaxie:') ? m.audit.galaxie : m.audit.panel;
  const roleName = (r: TenantRole | null) => (r ? m.roles[r] : '');
  // mudança de permissão: o `subject` é a ação da matriz, mostrada pelo nome no idioma da tela
  const labels: Record<string, string> = m.permissions.labels;
  const subjectOf = (e: MemberEvent) =>
    e.action === 'permission_granted' || e.action === 'permission_revoked'
      ? (labels[e.subject ?? ''] ?? e.subject ?? '')
      : (e.subject ?? '');

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title={m.title}
        description={m.description}
        action={manage ? <InviteDialog roles={invitable} /> : null}
      >
        {!manage ? <SafetyNote>{m.readOnly}</SafetyNote> : null}
        <Frame>
          <FramePanel className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.email}</TableHead>
                  <TableHead>{m.role}</TableHead>
                  <TableHead>{m.scope}</TableHead>
                  <TableHead>{m.since}</TableHead>
                  <TableHead className="text-right">{m.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((row) => (
                  <TableRow key={row.memberId}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {row.name}
                          {row.self ? (
                            <span className="text-muted-foreground font-normal"> ({m.you})</span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground text-xs">{row.email}</span>
                        {row.pending ? (
                          <Badge variant="warning-light" size="sm" className="w-fit">
                            {m.pending}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleCell row={row} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.scopeCount === null ? m.scopeAll : fill(m.scopeSome, { n: row.scopeCount })}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {fmt.date(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.removable ? <RemoveButton row={row} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FramePanel>
        </Frame>
        <SafetyNote>{m.volunteerNote}</SafetyNote>
      </SettingsSection>

      {permissions}

      <Frame>
        <FramePanel className="flex flex-col gap-3">
          <FrameHeader className="p-0">
            <FrameTitle className="flex items-center gap-2">
              <Users className="text-muted-foreground size-4" aria-hidden />
              {m.audit.title}
            </FrameTitle>
            <FrameDescription>{m.audit.description}</FrameDescription>
          </FrameHeader>
          {events.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.audit.when}</TableHead>
                  <TableHead>{m.audit.what}</TableHead>
                  <TableHead>{m.audit.who}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {fmt.dateTime(e.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {fill(m.audit.actions[e.action], {
                        subject: subjectOf(e),
                        from: roleName(e.fromRole),
                        to: roleName(e.toRole),
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{who(e.actor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">{m.audit.empty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
