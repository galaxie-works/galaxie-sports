'use client';

import type { TenantRole } from '@galaxie/engage';
import { Building2, Plus, RotateCw, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  changeMemberRole,
  changeOrganizationMemberRole,
  inviteMember,
  inviteOrganizationMember,
  reinviteMember,
  reinviteOrganizationMemberAction,
  removeMember,
  removeOrganizationMemberAction,
  type MemberActionResult,
} from '@/app/[locale]/(app)/client/users/actions';
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
import type { InviteStatus, MemberEvent, OrganizationMemberRole } from '@/lib/client/members';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface MemberRow {
  memberId: string;
  email: string;
  name: string;
  role: TenantRole;
  /** null = tenant inteiro; número = quantas Comunidades e Salas. */
  scopeCount: number | null;
  status: InviteStatus;
  createdAt: string;
  self: boolean;
  /** Cargos que quem vê pode dar a esta pessoa; vazio = não troca. */
  assignable: TenantRole[];
  removable: boolean;
}

/** Membro da organização (Dono ou Financeiro), que vale em todas as marcas. */
export interface OrganizationMemberItem {
  memberId: string;
  email: string;
  name: string;
  role: OrganizationMemberRole;
  status: InviteStatus;
  invitedAt: string;
  self: boolean;
}

export interface OrganizationSection {
  name: string;
  /** Quantas marcas o cargo alcança. */
  brands: number;
  members: OrganizationMemberItem[];
  /** Quem vê cuida dos cargos da organização (Dono ou equipe Galaxie). */
  manage: boolean;
}

type RoleOption<R extends string> = { value: R; label: string };

/** Janela de convite (marca ou organização): nome, e-mail e cargo. */
function InviteDialog<R extends string>({
  roles,
  help,
  title,
  description,
  initial,
  onSubmit,
}: {
  roles: RoleOption<R>[];
  help: (role: R) => string;
  title: string;
  description: string;
  initial: R;
  onSubmit: (input: { email: string; name: string; role: R }) => Promise<MemberActionResult>;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<R>(initial);
  const [pending, startTransition] = useTransition();
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
              const res = await onSubmit({ email, name, role });
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
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
              <Select items={roles} value={role} onValueChange={(v) => v && setRole(v as R)}>
                <SelectTrigger aria-label={m.role}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{help(role)}</FieldDescription>
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

/** Seletor de cargo numa linha (marca ou organização); sem opções, só o selo. */
function RoleSelect<R extends string>({
  value,
  options,
  label,
  email,
  onChange,
}: {
  value: R;
  options: RoleOption<R>[];
  label: (role: R) => string;
  email: string;
  onChange: (role: R) => Promise<MemberActionResult>;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const [pending, startTransition] = useTransition();
  if (!options.length) return <Badge variant="secondary">{label(value)}</Badge>;
  const items = options.some((o) => o.value === value)
    ? options
    : [{ value, label: label(value) }, ...options];
  return (
    <Select
      items={items}
      value={value}
      disabled={pending}
      onValueChange={(v) =>
        v &&
        v !== value &&
        startTransition(async () => {
          const res = await onChange(v as R);
          if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
          toast.success(m.changed);
          router.refresh();
        })
      }
    >
      <SelectTrigger className="w-44" aria-label={`${m.role} · ${email}`}>
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

function RemoveButton({
  email,
  body,
  onRemove,
}: {
  email: string;
  body: string;
  onRemove: () => Promise<MemberActionResult>;
}) {
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
          <AlertDialogTitle>{fill(m.removeTitle, { email })}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const res = await onRemove();
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

/** "Convidar de novo": prazo novo para quem ainda não entrou (pendente ou vencido). */
function ReinviteButton({
  onReinvite,
  email,
}: {
  onReinvite: () => Promise<MemberActionResult>;
  email: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.client.members;
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await onReinvite();
          if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
          toast.success(fill(m.invited, { email }));
          if (res.link) toast.info(fill(m.inviteLink, { link: res.link }), { duration: 30_000 });
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <RotateCw aria-hidden />}
      {m.reinvite}
    </Button>
  );
}

function StatusBadge({ status }: { status: InviteStatus }) {
  const { t } = useI18n();
  const m = t.client.members;
  if (status === 'active') return null;
  return (
    <Badge variant={status === 'expired' ? 'destructive-light' : 'warning-light'} size="sm" className="w-fit">
      {status === 'expired' ? m.expired : m.pending}
    </Badge>
  );
}

function PersonCell({
  name,
  email,
  self,
  status,
}: {
  name: string;
  email: string;
  self: boolean;
  status: InviteStatus;
}) {
  const { t } = useI18n();
  const m = t.client.members;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">
        {name}
        {self ? <span className="text-muted-foreground font-normal"> ({m.you})</span> : null}
      </span>
      <span className="text-muted-foreground text-xs">{email}</span>
      <StatusBadge status={status} />
    </div>
  );
}

/** Cliente → Conta → Usuários e cargos (#1019, #1136): organização, equipe da marca, cargos, convite e auditoria. */
export function MembersPanel({
  members,
  invitable,
  organization,
  events,
  timeZone,
  permissions,
}: {
  members: MemberRow[];
  /** Cargos que quem vê pode dar num convite da marca; vazio = só leitura. */
  invitable: TenantRole[];
  /** A organização da marca, com Dono e Financeiro; null = marca ainda sem organização. */
  organization: OrganizationSection | null;
  events: MemberEvent[];
  timeZone: string;
  /** Permissões por cargo, entre a equipe e a auditoria. */
  permissions?: ReactNode;
}) {
  const { t } = useI18n();
  const m = t.client.members;
  const o = m.organization;
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
  const brandRoles: RoleOption<TenantRole>[] = invitable.map((r) => ({ value: r, label: m.roles[r] }));
  const orgRoles: RoleOption<OrganizationMemberRole>[] = (['owner', 'billing'] as const).map((r) => ({
    value: r,
    label: m.roles[r],
  }));

  return (
    <div className="flex flex-col gap-6">
      {organization ? (
        <SettingsSection
          title={fill(o.title, { name: organization.name })}
          description={fill(o.description, { n: organization.brands })}
          action={
            organization.manage ? (
              <InviteDialog
                roles={orgRoles}
                help={(r) => m.roleHelp[r]}
                title={o.inviteTitle}
                description={o.inviteDescription}
                initial="billing"
                onSubmit={inviteOrganizationMember}
              />
            ) : null
          }
        >
          <Frame>
            <FramePanel className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{m.email}</TableHead>
                    <TableHead>{m.role}</TableHead>
                    <TableHead>{m.since}</TableHead>
                    <TableHead className="text-right">{m.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organization.members.map((row) => (
                    <TableRow key={row.memberId}>
                      <TableCell>
                        <PersonCell name={row.name} email={row.email} self={row.self} status={row.status} />
                      </TableCell>
                      <TableCell>
                        <RoleSelect
                          value={row.role}
                          options={organization.manage ? orgRoles : []}
                          label={(r) => m.roles[r]}
                          email={row.email}
                          onChange={(role) => changeOrganizationMemberRole({ memberId: row.memberId, role })}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        {fmt.date(row.invitedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {organization.manage ? (
                          <div className="flex justify-end gap-2">
                            {row.status !== 'active' ? (
                              <ReinviteButton
                                email={row.email}
                                onReinvite={() =>
                                  reinviteOrganizationMemberAction({ memberId: row.memberId })
                                }
                              />
                            ) : null}
                            <RemoveButton
                              email={row.email}
                              body={o.removeBody}
                              onRemove={() => removeOrganizationMemberAction({ memberId: row.memberId })}
                            />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </FramePanel>
          </Frame>
          {!organization.manage ? <SafetyNote>{o.readOnly}</SafetyNote> : null}
        </SettingsSection>
      ) : null}

      <SettingsSection
        title={m.title}
        description={m.description}
        action={
          manage ? (
            <InviteDialog
              roles={brandRoles}
              help={(r) => m.roleHelp[r]}
              title={m.inviteTitle}
              description={m.inviteDescription}
              initial={invitable[invitable.length - 1] ?? 'moderator'}
              onSubmit={inviteMember}
            />
          ) : null
        }
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
                      <PersonCell name={row.name} email={row.email} self={row.self} status={row.status} />
                    </TableCell>
                    <TableCell>
                      <RoleSelect
                        value={row.role}
                        options={row.assignable.map((r) => ({ value: r, label: m.roles[r] }))}
                        label={(r) => m.roles[r]}
                        email={row.email}
                        onChange={(role) => changeMemberRole({ memberId: row.memberId, role })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.scopeCount === null ? m.scopeAll : fill(m.scopeSome, { n: row.scopeCount })}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {fmt.date(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {row.status !== 'active' && row.assignable.length ? (
                          <ReinviteButton
                            email={row.email}
                            onReinvite={() => reinviteMember({ memberId: row.memberId })}
                          />
                        ) : null}
                        {row.removable ? (
                          <RemoveButton
                            email={row.email}
                            body={m.removeBody}
                            onRemove={() => removeMember({ memberId: row.memberId })}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </FramePanel>
        </Frame>
        <SafetyNote>{m.volunteerNote}</SafetyNote>
        <SafetyNote>{fill(m.inviteTtl, { days: 7 })}</SafetyNote>
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
      {organization ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Building2 className="size-3.5" aria-hidden />
          {o.auditNote}
        </p>
      ) : null}
    </div>
  );
}
