'use client';

import {
  Activity,
  ArrowLeft,
  Copy,
  Eye,
  KeyRound,
  LogIn,
  Monitor,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  removeUser,
  resendInvite,
  revokeAllSessions,
  revokeSession,
  setDisabled,
  updateAccess,
  updateProfile,
  type ActionResult,
} from '@/app/[locale]/(app)/ajustes/actions';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@/components/reui/timeline';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { DemoActivity, DemoSession, DemoUser } from '@/lib/auth/admin';
import type { Role } from '@/lib/auth/roles';
import type { TenantOption } from '@/lib/client/tenants';
import { initials } from '@/lib/format';
import { internalPath } from '@/lib/internal-path';
import { useI18n } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { fill, plural, rich } from '@/lib/i18n/text';

import { TenantSelect, useAccessPresets, useRoles } from './invite-dialog';
import { LocaleSelect, RoleBadge, StatusBadge, useAdminFormat } from './user-badges';

/** Roda uma ação do servidor com toast e atualiza a página. */
function useAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? t.admin.feedback.failed);
      if (res.emailSent === false && res.link) {
        void navigator.clipboard.writeText(res.link);
        toast.warning(t.admin.feedback.emailNotSent);
      } else toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

/** Linha "rótulo + descrição | controle" dos cartões (padrão da tela de referência). */
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description ? <span className="text-muted-foreground text-xs">{description}</span> : null}
      </div>
      <div className="sm:w-72">{children}</div>
    </div>
  );
}

function ProfileTab({ user }: { user: DemoUser }) {
  const { t } = useI18n();
  const { pending, run } = useAction();
  const [form, setForm] = useState({
    name: user.name,
    jobTitle: user.jobTitle ?? '',
    company: user.company ?? '',
    phone: user.phone ?? '',
    notes: user.notes ?? '',
  });
  // Idioma só vai para o servidor quando muda (nulo = não definido, mantém).
  const [locale, setLocale] = useState<Locale | null>(user.locale);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>{t.admin.profile.title}</FrameTitle>
          <FrameDescription>{t.admin.profile.description}</FrameDescription>
        </FrameHeader>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="p-name">{t.admin.fields.name}</FieldLabel>
            <Input id="p-name" value={form.name} onChange={set('name')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-email">{t.admin.fields.email}</FieldLabel>
            <Input id="p-email" value={user.email} disabled />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-job">{t.admin.fields.jobTitle}</FieldLabel>
            <Input id="p-job" value={form.jobTitle} onChange={set('jobTitle')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-company">{t.admin.fields.company}</FieldLabel>
            <Input id="p-company" value={form.company} onChange={set('company')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-phone">{t.admin.fields.phone}</FieldLabel>
            <Input id="p-phone" type="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-locale">{t.admin.fields.language}</FieldLabel>
            <LocaleSelect
              id="p-locale"
              value={locale}
              onChange={setLocale}
              placeholder={t.admin.profile.languageUnset}
            />
            <FieldDescription>{t.admin.profile.languageHint}</FieldDescription>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="p-notes">{t.admin.fields.notes}</FieldLabel>
            <Textarea id="p-notes" rows={3} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <FrameFooter className="flex-row justify-end">
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateProfile(user.id, {
                    ...form,
                    ...(locale !== user.locale ? { locale } : {}),
                  }),
                t.admin.profile.saved,
              )
            }
          >
            {pending ? <Spinner /> : null}
            {t.admin.profile.save}
          </Button>
        </FrameFooter>
      </FramePanel>
    </Frame>
  );
}

function AccessTab({
  user,
  tenants,
  isSelf,
  timeZone,
}: {
  user: DemoUser;
  tenants: TenantOption[];
  isSelf: boolean;
  timeZone: string;
}) {
  const { t } = useI18n();
  const { relativeTime } = useAdminFormat(timeZone);
  const accessPresets = useAccessPresets();
  const roles = useRoles();
  const { pending, run } = useAction();
  const [role, setRole] = useState<Role>(user.role);
  const [tenantId, setTenantId] = useState<string | null>(user.tenant?.id ?? null);
  const [date, setDate] = useState(user.accessExpiresAt ? user.accessExpiresAt.slice(0, 10) : '');

  /** Estende a partir de hoje ou da data atual, o que for mais tarde. */
  function extend(days: string) {
    if (days === 'none') return setDate('');
    const base = Math.max(Date.now(), date ? new Date(`${date}T23:59:59`).getTime() : 0);
    setDate(new Date(base + Number(days) * 86_400_000).toISOString().slice(0, 10));
  }

  const invite = user.lastInvite;
  const inviteText = invite
    ? fill(
        invite.kind === 'invite'
          ? invite.delivered
            ? t.admin.inviteCard.inviteSent
            : t.admin.inviteCard.inviteGenerated
          : invite.delivered
            ? t.admin.inviteCard.legacySent
            : t.admin.inviteCard.legacyGenerated,
        { when: relativeTime(invite.at) },
      )
    : t.admin.inviteCard.none;

  return (
    <div className="flex flex-col gap-6">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{t.admin.accessTab.title}</FrameTitle>
            <FrameDescription>{t.admin.accessTab.description}</FrameDescription>
          </FrameHeader>
          <Row title={t.admin.fields.role} description={t.admin.accessTab.roleHint}>
            <Select items={roles} value={role} onValueChange={(v) => setRole(v as Role)} disabled={isSelf}>
              <SelectTrigger className="w-full" aria-label={t.admin.fields.role}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {role === 'client' ? (
            <Row title={t.admin.tenant.label} description={t.admin.tenant.hint}>
              <TenantSelect tenants={tenants} value={tenantId} onChange={setTenantId} />
            </Row>
          ) : null}
          <Row
            title={t.admin.accessTab.validUntil}
            description={
              role === 'admin' ? t.admin.accessTab.validUntilHintAdmin : t.admin.accessTab.validUntilHint
            }
          >
            <div className="flex flex-col gap-2">
              <Input
                type="date"
                aria-label={t.admin.accessTab.validUntil}
                value={role === 'admin' ? '' : date}
                onChange={(e) => setDate(e.target.value)}
                disabled={role === 'admin'}
              />
              <div className="flex flex-wrap gap-1.5">
                {accessPresets.map((p) => (
                  <Button
                    key={p.value}
                    size="xs"
                    variant="outline"
                    disabled={role === 'admin'}
                    onClick={() => extend(p.value)}
                  >
                    {p.value === 'none' ? p.label : fill(t.admin.access.extendBy, { days: p.label })}
                  </Button>
                ))}
              </div>
            </div>
          </Row>
          <FrameFooter className="flex-row justify-end">
            <Button
              disabled={pending || (role === 'client' && !tenantId)}
              onClick={() =>
                run(
                  () =>
                    updateAccess(user.id, {
                      role,
                      tenantId: role === 'client' ? tenantId : null,
                      accessExpiresAt:
                        role === 'admin' || !date ? null : new Date(`${date}T23:59:59-03:00`).toISOString(),
                    }),
                  t.admin.accessTab.saved,
                )
              }
            >
              {pending ? <Spinner /> : null}
              {t.admin.accessTab.save}
            </Button>
          </FrameFooter>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{t.admin.inviteCard.title}</FrameTitle>
            <FrameDescription>{inviteText}</FrameDescription>
          </FrameHeader>
          <Row title={t.admin.inviteCard.resend} description={t.admin.inviteCard.resendHint}>
            <Button
              variant="outline"
              className="w-full"
              disabled={pending}
              onClick={() => run(() => resendInvite(user.id), t.admin.inviteCard.resent)}
            >
              <KeyRound />
              {t.admin.inviteCard.resend}
            </Button>
          </Row>
        </FramePanel>
      </Frame>
    </div>
  );
}

function SessionsTab({
  user,
  sessions,
  timeZone,
}: {
  user: DemoUser;
  sessions: DemoSession[];
  timeZone: string;
}) {
  const { locale, t } = useI18n();
  const { describeAgent, formatDate, formatIp, relativeTime } = useAdminFormat(timeZone);
  const { pending, run } = useAction();
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>{t.admin.sessions.title}</FrameTitle>
          <FrameDescription>
            {sessions.length
              ? plural(locale, sessions.length, t.admin.sessions.devices)
              : t.admin.sessions.none}
          </FrameDescription>
        </FrameHeader>
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <Monitor className="text-muted-foreground size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{describeAgent(s.userAgent)}</span>
              <span className="text-muted-foreground truncate text-xs">
                {fill(t.admin.sessions.details, {
                  ip: formatIp(s.ipAddress) ?? t.admin.device.unknownIp,
                  when: relativeTime(s.updatedAt),
                  date: formatDate(s.expiresAt),
                })}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => revokeSession(user.id, s.token), t.admin.sessions.ended)}
            >
              {t.admin.sessions.end}
            </Button>
          </div>
        ))}
        {sessions.length > 1 ? (
          <FrameFooter className="flex-row justify-end">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => revokeAllSessions(user.id), t.admin.sessions.endedAll)}
            >
              <LogIn />
              {t.admin.sessions.endAll}
            </Button>
          </FrameFooter>
        ) : null}
      </FramePanel>
    </Frame>
  );
}

/**
 * Caminho registrado pelo navegador: vira link só se for da própria demo. Registros antigos (de antes
 * de a rota de atividade validar a origem) podem ter `//evil.com/x`; esses ficam como texto.
 */
function ActivityPath({ path }: { path: string | null }) {
  const href = internalPath(path);
  if (!href) return <span>{path}</span>;
  return (
    <Link href={href} className="hover:underline">
      {path}
    </Link>
  );
}

function ActivityTab({ activity, timeZone }: { activity: DemoActivity[]; timeZone: string }) {
  const { t } = useI18n();
  const { describeAgent, formatDateTime, formatIp } = useAdminFormat(timeZone);
  if (!activity.length) {
    return (
      <Frame>
        <FramePanel>
          <FrameHeader>
            <FrameTitle>{t.admin.activity.title}</FrameTitle>
            <FrameDescription>{t.admin.activity.empty}</FrameDescription>
          </FrameHeader>
        </FramePanel>
      </Frame>
    );
  }
  return (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>{t.admin.activity.title}</FrameTitle>
          <FrameDescription>{t.admin.activity.description}</FrameDescription>
        </FrameHeader>
        <div className="p-4">
          <Timeline defaultValue={0}>
            {activity.map((a, i) => (
              <TimelineItem key={a.id} step={i + 1}>
                <TimelineHeader>
                  <TimelineDate>{formatDateTime(a.createdAt)}</TimelineDate>
                  <TimelineTitle className="flex items-center gap-2">
                    {a.kind === 'login' ? <LogIn className="size-3.5" /> : <Eye className="size-3.5" />}
                    {a.kind === 'login' ? t.admin.activity.login : (a.title ?? a.path)}
                  </TimelineTitle>
                </TimelineHeader>
                <TimelineIndicator />
                <TimelineSeparator />
                <TimelineContent className="text-muted-foreground text-xs">
                  {a.kind === 'login' ? (
                    `${describeAgent(a.userAgent)}${formatIp(a.ipAddress) ? ` · ${formatIp(a.ipAddress)}` : ''}`
                  ) : (
                    <>
                      <ActivityPath path={a.path} />
                      {/* Trilha de navegação (registros antigos não têm). */}
                      {a.fromPath ? (
                        <>
                          {' · '}
                          {rich(
                            t.admin.activity.cameFrom,
                            {
                              link: () => <ActivityPath path={a.fromPath} />,
                            },
                            { path: a.fromPath },
                          )}
                        </>
                      ) : null}
                      {a.trailDepth ? ` · ${fill(t.admin.activity.trailStep, { step: a.trailDepth })}` : null}
                    </>
                  )}
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        </div>
      </FramePanel>
    </Frame>
  );
}

function DangerTab({ user, isSelf }: { user: DemoUser; isSelf: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const d = t.admin.danger;
  const { pending, run } = useAction();
  const disabled = user.status === 'disabled';
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>{d.title}</FrameTitle>
          <FrameDescription>{d.description}</FrameDescription>
        </FrameHeader>
        <Row
          title={disabled ? d.reactivateTitle : d.deactivateTitle}
          description={disabled ? d.reactivateHint : d.deactivateHint}
        >
          <Button
            variant="outline"
            className="w-full"
            disabled={pending || isSelf}
            onClick={() =>
              run(() => setDisabled(user.id, !disabled), disabled ? d.reactivated : d.deactivated)
            }
          >
            <ShieldCheck />
            {disabled ? d.reactivate : d.deactivate}
          </Button>
        </Row>
        <Row title={d.removeTitle} description={d.removeHint}>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" className="w-full" disabled={pending || isSelf} />}
            >
              <Trash2 />
              {d.remove}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{fill(d.confirmTitle, { name: user.name })}</AlertDialogTitle>
                <AlertDialogDescription>{d.confirmDescription}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    run(
                      () => removeUser(user.id),
                      d.removed,
                      () => router.replace('/ajustes/usuarios'),
                    )
                  }
                >
                  {d.remove}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Row>
      </FramePanel>
    </Frame>
  );
}

export function UserDetail({
  user,
  tenants,
  sessions,
  activity,
  currentUserId,
  timeZone,
}: {
  user: DemoUser;
  tenants: TenantOption[];
  sessions: DemoSession[];
  activity: DemoActivity[];
  currentUserId?: string;
  /** Fuso de quem vê (lido no servidor), para as datas baterem entre servidor e hidratação. */
  timeZone: string;
}) {
  const { t } = useI18n();
  const { accessLabel, formatDate, relativeTime } = useAdminFormat(timeZone);
  const isSelf = currentUserId === user.id;
  const subtitle = [user.email, user.jobTitle, user.company].filter(Boolean).join(' · ');
  const summary = [
    accessLabel(user.role, user.accessExpiresAt),
    fill(t.admin.detail.since, { date: formatDate(user.createdAt) }),
    user.lastLoginAt ? fill(t.admin.detail.lastSeen, { when: relativeTime(user.lastLoginAt) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const tabs = t.admin.detail.tabs;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/ajustes/usuarios"
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t.admin.detail.back}
      </Link>
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{user.name}</h2>
            <StatusBadge status={user.status} />
            <RoleBadge role={user.role} />
          </div>
          <span className="text-muted-foreground truncate text-sm">{subtitle}</span>
          <span className="text-muted-foreground text-xs">{summary}</span>
        </div>
      </div>

      <Tabs defaultValue="perfil" orientation="vertical" className="gap-6 md:flex-row">
        <TabsList variant="line" className="h-fit shrink-0 md:w-48">
          <TabsTrigger value="perfil">
            <UserRound />
            {tabs.profile}
          </TabsTrigger>
          <TabsTrigger value="acesso">
            <KeyRound />
            {tabs.access}
          </TabsTrigger>
          <TabsTrigger value="sessoes">
            <Monitor />
            {tabs.sessions}
            {sessions.length ? (
              <Badge size="sm" variant="secondary">
                {sessions.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="atividade">
            <Activity />
            {tabs.activity}
          </TabsTrigger>
          <TabsTrigger value="perigo">
            <TriangleAlert />
            {tabs.danger}
          </TabsTrigger>
        </TabsList>
        <div className="min-w-0 flex-1">
          <TabsContent value="perfil">
            <ProfileTab user={user} />
          </TabsContent>
          <TabsContent value="acesso">
            <AccessTab user={user} tenants={tenants} isSelf={isSelf} timeZone={timeZone} />
          </TabsContent>
          <TabsContent value="sessoes">
            <SessionsTab user={user} sessions={sessions} timeZone={timeZone} />
          </TabsContent>
          <TabsContent value="atividade">
            <ActivityTab activity={activity} timeZone={timeZone} />
          </TabsContent>
          <TabsContent value="perigo">
            <DangerTab user={user} isSelf={isSelf} />
          </TabsContent>
        </div>
      </Tabs>

      {user.status === 'pending' ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Copy className="size-3.5" />
          {t.admin.detail.pendingHint}
        </p>
      ) : null}
    </div>
  );
}
