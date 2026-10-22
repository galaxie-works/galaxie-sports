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
} from '@/app/(app)/ajustes/actions';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { DemoActivity, DemoSession, DemoUser } from '@/lib/auth/admin';
import { initials } from '@/lib/format';

import { ACCESS_PRESETS } from './invite-dialog';
import {
  accessLabel,
  describeAgent,
  formatDate,
  formatDateTime,
  formatIp,
  relativeTime,
  RoleBadge,
  StatusBadge,
} from './user-badges';

/** Roda uma ação do servidor com toast e atualiza a página. */
function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? 'Não foi possível concluir.');
      if (res.emailSent === false && res.link) {
        void navigator.clipboard.writeText(res.link);
        toast.warning('E-mail não enviado: link do convite copiado para colar em outro canal.');
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
  const { pending, run } = useAction();
  const [form, setForm] = useState({
    name: user.name,
    jobTitle: user.jobTitle ?? '',
    company: user.company ?? '',
    phone: user.phone ?? '',
    notes: user.notes ?? '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>Perfil</FrameTitle>
          <FrameDescription>Quem é a pessoa e de onde ela vem.</FrameDescription>
        </FrameHeader>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="p-name">Nome</FieldLabel>
            <Input id="p-name" value={form.name} onChange={set('name')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-email">E-mail</FieldLabel>
            <Input id="p-email" value={user.email} disabled />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-job">Cargo</FieldLabel>
            <Input id="p-job" value={form.jobTitle} onChange={set('jobTitle')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-company">Empresa</FieldLabel>
            <Input id="p-company" value={form.company} onChange={set('company')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-phone">Telefone</FieldLabel>
            <Input id="p-phone" type="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="p-notes">Observações</FieldLabel>
            <Textarea id="p-notes" rows={3} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <FrameFooter className="flex-row justify-end">
          <Button disabled={pending} onClick={() => run(() => updateProfile(user.id, form), 'Perfil salvo')}>
            {pending ? <Spinner /> : null}
            Salvar perfil
          </Button>
        </FrameFooter>
      </FramePanel>
    </Frame>
  );
}

const ROLES = [
  { value: 'user', label: 'Convidado' },
  { value: 'admin', label: 'Admin' },
];

function AccessTab({ user, isSelf }: { user: DemoUser; isSelf: boolean }) {
  const { pending, run } = useAction();
  const [role, setRole] = useState<'admin' | 'user'>(user.role);
  const [date, setDate] = useState(user.accessExpiresAt ? user.accessExpiresAt.slice(0, 10) : '');

  /** Estende a partir de hoje ou da data atual, o que for mais tarde. */
  function extend(days: string) {
    if (days === 'none') return setDate('');
    const base = Math.max(Date.now(), date ? new Date(`${date}T23:59:59`).getTime() : 0);
    setDate(new Date(base + Number(days) * 86_400_000).toISOString().slice(0, 10));
  }

  return (
    <div className="flex flex-col gap-6">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>Acesso</FrameTitle>
            <FrameDescription>Papel e por quanto tempo a pessoa pode entrar.</FrameDescription>
          </FrameHeader>
          <Row title="Papel" description="Admin gerencia usuários; convidado só navega na demo.">
            <Select
              items={ROLES}
              value={role}
              onValueChange={(v) => setRole(v as 'admin' | 'user')}
              disabled={isSelf}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row
            title="Válido até"
            description={
              role === 'admin'
                ? 'Admins não têm prazo.'
                : 'Depois desta data o login é bloqueado. Vazio = sem prazo.'
            }
          >
            <div className="flex flex-col gap-2">
              <Input
                type="date"
                value={role === 'admin' ? '' : date}
                onChange={(e) => setDate(e.target.value)}
                disabled={role === 'admin'}
              />
              <div className="flex flex-wrap gap-1.5">
                {ACCESS_PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    size="xs"
                    variant="outline"
                    disabled={role === 'admin'}
                    onClick={() => extend(p.value)}
                  >
                    {p.value === 'none' ? p.label : `+${p.label}`}
                  </Button>
                ))}
              </div>
            </div>
          </Row>
          <FrameFooter className="flex-row justify-end">
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updateAccess(user.id, {
                      role,
                      accessExpiresAt:
                        role === 'admin' || !date ? null : new Date(`${date}T23:59:59-03:00`).toISOString(),
                    }),
                  'Acesso atualizado',
                )
              }
            >
              {pending ? <Spinner /> : null}
              Salvar acesso
            </Button>
          </FrameFooter>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>Convite</FrameTitle>
            <FrameDescription>
              {user.lastInvite
                ? `${user.lastInvite.kind === 'invite' ? 'Convite' : 'Link de senha'} ${user.lastInvite.delivered ? 'enviado' : 'gerado (sem e-mail)'} ${relativeTime(user.lastInvite.at)}.`
                : 'Nenhum convite registrado.'}
            </FrameDescription>
          </FrameHeader>
          <Row
            title={user.status === 'pending' ? 'Reenviar convite' : 'Enviar link para trocar a senha'}
            description="Um novo link substitui o anterior e vale por 72 horas."
          >
            <Button
              variant="outline"
              className="w-full"
              disabled={pending}
              onClick={() => run(() => resendInvite(user.id), 'Link enviado por e-mail')}
            >
              <KeyRound />
              {user.status === 'pending' ? 'Reenviar convite' : 'Enviar link'}
            </Button>
          </Row>
        </FramePanel>
      </Frame>
    </div>
  );
}

function SessionsTab({ user, sessions }: { user: DemoUser; sessions: DemoSession[] }) {
  const { pending, run } = useAction();
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>Sessões ativas</FrameTitle>
          <FrameDescription>
            {sessions.length ? `${sessions.length} dispositivo(s) conectado(s)` : 'Nenhuma sessão ativa.'}
          </FrameDescription>
        </FrameHeader>
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <Monitor className="text-muted-foreground size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{describeAgent(s.userAgent)}</span>
              <span className="text-muted-foreground truncate text-xs">
                {formatIp(s.ipAddress) ?? 'IP desconhecido'} · última atividade {relativeTime(s.updatedAt)} ·
                expira {formatDate(s.expiresAt)}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => revokeSession(user.id, s.token), 'Sessão encerrada')}
            >
              Encerrar
            </Button>
          </div>
        ))}
        {sessions.length > 1 ? (
          <FrameFooter className="flex-row justify-end">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => revokeAllSessions(user.id), 'Sessões encerradas')}
            >
              <LogIn />
              Encerrar todas
            </Button>
          </FrameFooter>
        ) : null}
      </FramePanel>
    </Frame>
  );
}

function ActivityTab({ activity }: { activity: DemoActivity[] }) {
  if (!activity.length) {
    return (
      <Frame>
        <FramePanel>
          <FrameHeader>
            <FrameTitle>Atividade</FrameTitle>
            <FrameDescription>Ainda não há registros: a pessoa não entrou na demo.</FrameDescription>
          </FrameHeader>
        </FramePanel>
      </Frame>
    );
  }
  return (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Atividade</FrameTitle>
          <FrameDescription>
            Logins e páginas abertas, do mais recente ao mais antigo (até 100).
          </FrameDescription>
        </FrameHeader>
        <div className="p-4">
          <Timeline defaultValue={0}>
            {activity.map((a, i) => (
              <TimelineItem key={a.id} step={i + 1}>
                <TimelineHeader>
                  <TimelineDate>{formatDateTime(a.createdAt)}</TimelineDate>
                  <TimelineTitle className="flex items-center gap-2">
                    {a.kind === 'login' ? <LogIn className="size-3.5" /> : <Eye className="size-3.5" />}
                    {a.kind === 'login' ? 'Entrou na demo' : (a.title ?? a.path)}
                  </TimelineTitle>
                </TimelineHeader>
                <TimelineIndicator />
                <TimelineSeparator />
                <TimelineContent className="text-muted-foreground text-xs">
                  {a.kind === 'login' ? (
                    `${describeAgent(a.userAgent)}${formatIp(a.ipAddress) ? ` · ${formatIp(a.ipAddress)}` : ''}`
                  ) : (
                    <>
                      <Link href={a.path ?? '/'} className="hover:underline">
                        {a.path}
                      </Link>
                      {/* Trilha de navegação (registros antigos não têm). */}
                      {a.fromPath ? (
                        <>
                          {' · veio de '}
                          <Link href={a.fromPath} className="hover:underline">
                            {a.fromPath}
                          </Link>
                        </>
                      ) : null}
                      {a.trailDepth ? ` · passo ${a.trailDepth} da trilha` : null}
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
  const { pending, run } = useAction();
  const disabled = user.status === 'disabled';
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>Zona de perigo</FrameTitle>
          <FrameDescription>Ações que tiram o acesso da pessoa.</FrameDescription>
        </FrameHeader>
        <Row
          title={disabled ? 'Reativar acesso' : 'Desativar acesso'}
          description={
            disabled
              ? 'A pessoa volta a poder entrar.'
              : 'Bloqueia o login e encerra as sessões. Dá para reativar.'
          }
        >
          <Button
            variant="outline"
            className="w-full"
            disabled={pending || isSelf}
            onClick={() =>
              run(() => setDisabled(user.id, !disabled), disabled ? 'Acesso reativado' : 'Acesso desativado')
            }
          >
            <ShieldCheck />
            {disabled ? 'Reativar' : 'Desativar'}
          </Button>
        </Row>
        <Row
          title="Remover usuário"
          description="Apaga a conta, as sessões e o histórico. Não dá para desfazer."
        >
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" className="w-full" disabled={pending || isSelf} />}
            >
              <Trash2 />
              Remover
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover {user.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A conta, as sessões e o histórico de atividade serão apagados. Para só bloquear o acesso,
                  use “Desativar”.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    run(
                      () => removeUser(user.id),
                      'Usuário removido',
                      () => router.replace('/ajustes/usuarios'),
                    )
                  }
                >
                  Remover
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
  sessions,
  activity,
  currentUserId,
}: {
  user: DemoUser;
  sessions: DemoSession[];
  activity: DemoActivity[];
  currentUserId?: string;
}) {
  const isSelf = currentUserId === user.id;
  const subtitle = [user.email, user.jobTitle, user.company].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/ajustes/usuarios"
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        Usuários
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
          <span className="text-muted-foreground text-xs">
            {accessLabel(user.role, user.accessExpiresAt)} · desde {formatDate(user.createdAt)}
            {user.lastLoginAt ? ` · último acesso ${relativeTime(user.lastLoginAt)}` : ''}
          </span>
        </div>
      </div>

      <Tabs defaultValue="perfil" orientation="vertical" className="gap-6 md:flex-row">
        <TabsList variant="line" className="h-fit shrink-0 md:w-48">
          <TabsTrigger value="perfil">
            <UserRound />
            Perfil
          </TabsTrigger>
          <TabsTrigger value="acesso">
            <KeyRound />
            Acesso
          </TabsTrigger>
          <TabsTrigger value="sessoes">
            <Monitor />
            Sessões
            {sessions.length ? (
              <Badge size="sm" variant="secondary">
                {sessions.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="atividade">
            <Activity />
            Atividade
          </TabsTrigger>
          <TabsTrigger value="perigo">
            <TriangleAlert />
            Zona de perigo
          </TabsTrigger>
        </TabsList>
        <div className="min-w-0 flex-1">
          <TabsContent value="perfil">
            <ProfileTab user={user} />
          </TabsContent>
          <TabsContent value="acesso">
            <AccessTab user={user} isSelf={isSelf} />
          </TabsContent>
          <TabsContent value="sessoes">
            <SessionsTab user={user} sessions={sessions} />
          </TabsContent>
          <TabsContent value="atividade">
            <ActivityTab activity={activity} />
          </TabsContent>
          <TabsContent value="perigo">
            <DangerTab user={user} isSelf={isSelf} />
          </TabsContent>
        </div>
      </Tabs>

      {user.status === 'pending' ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Copy className="size-3.5" />
          Enquanto a pessoa não criar a senha, o status fica como “Convite pendente”.
        </p>
      ) : null}
    </div>
  );
}
