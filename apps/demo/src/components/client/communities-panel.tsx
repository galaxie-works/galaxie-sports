'use client';

import { Copy, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  addScopeRuleAction,
  createInviteAction,
  decideJoinRequestAction,
  publishTermsAction,
  removeScopeRuleAction,
  saveCommunityConfigAction,
  suspendCommunityAction,
  type CommunityActionResult,
} from '@/app/[locale]/(app)/client/communities/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { CommunitiesOverview, CommunityView } from '@/lib/client/communities';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { EntityPicker, type EntityValue } from './entity-picker';

const SCOPE_KINDS = ['competition_participants', 'competition', 'participant', 'person', 'sport'] as const;
type ScopeKind = (typeof SCOPE_KINDS)[number];
const JOIN_MODES = ['open', 'approval', 'closed'] as const;

const PICKER: Record<Exclude<ScopeKind, 'sport'>, 'competition' | 'team' | 'person'> = {
  competition_participants: 'competition',
  competition: 'competition',
  participant: 'team',
  person: 'person',
};

const STATE_BADGE = { active: 'success-light', archived: 'secondary', suspended: 'warning-light' } as const;

type Dialogs =
  | { kind: 'config'; c: CommunityView }
  | { kind: 'terms'; c: CommunityView }
  | { kind: 'invite'; c: CommunityView }
  | null;

/**
 * Cliente → Engajamento → Comunidades (#939): o escopo que cria as Comunidades, a lista com a configuração de cada
 * uma (Modo de entrada, post de membro, Chat, janela), termos por versão, convites e a fila de aprovação. As regras
 * ficam em `@galaxie/engage` e o servidor confere de novo ao gravar.
 */
export function CommunitiesPanel({
  data,
  galaxie,
  timeZone,
}: {
  data: CommunitiesOverview;
  /** Equipe da Galaxie: pode suspender e reativar. */
  galaxie: boolean;
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.communities;
  const f = useFormatters(timeZone);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [kind, setKind] = useState<ScopeKind>('competition_participants');
  const [entity, setEntity] = useState<EntityValue | null>(null);
  const [sport, setSport] = useState<string>('');

  const names = new Map(data.communities.map((c) => [c.id, c.name ?? T.list.unnamed]));

  function run(action: () => Promise<CommunityActionResult>, after?: (r: CommunityActionResult) => void) {
    start(async () => {
      const r = await action();
      if (!r.ok) {
        toast.error(r.error ?? T.errors.generic);
        return;
      }
      if (r.sync) {
        toast.success(fill(T.scope.synced, r.sync));
        if (r.sync.overLimit) toast.warning(fill(T.scope.overLimit, { count: r.sync.overLimit }));
      } else if (!r.code) toast.success(T.saved);
      after?.(r);
      router.refresh();
    });
  }

  const target = kind === 'sport' ? sport : (entity?.id ?? '');

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.scope.title}</FrameTitle>
              <FrameDescription>{T.scope.description}</FrameDescription>
            </div>
            <span className="text-muted-foreground text-xs">
              {fill(T.scope.usage, { active: data.active, limit: data.limit })}
            </span>
          </FrameHeader>
          <div className="flex flex-col gap-3 border-t p-4 md:flex-row md:items-end">
            <Field className="md:w-64">
              <FieldLabel>{T.scope.kind}</FieldLabel>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as ScopeKind);
                  setEntity(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {T.scope.kinds[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="min-w-0 flex-1">
              <FieldLabel>{T.scope.target}</FieldLabel>
              {kind === 'sport' ? (
                <Select value={sport} onValueChange={(v) => setSport(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder={T.scope.sportPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {data.sports.map((s) => (
                      <SelectItem key={s.slug} value={s.slug}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <EntityPicker types={[PICKER[kind]]} value={entity} onChange={setEntity} />
              )}
            </Field>
            <Button
              disabled={pending || !target}
              onClick={() =>
                run(
                  () => addScopeRuleAction({ kind, target }),
                  () => setEntity(null),
                )
              }
            >
              {pending ? <Spinner /> : <Plus />}
              {T.scope.add}
            </Button>
          </div>
          {data.rules.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.scope.kind}</TableHead>
                  <TableHead>{T.scope.target}</TableHead>
                  <TableHead className="sr-only">{T.scope.remove}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{T.scope.kinds[r.kind as ScopeKind] ?? r.kind}</TableCell>
                    <TableCell className="font-medium">{r.name ?? r.target}</TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        aria-label={T.scope.remove}
                        onClick={() => run(() => removeScopeRuleAction({ id: r.id }))}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground border-t p-4 text-sm">{T.scope.empty}</p>
          )}
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-col gap-1 p-4">
            <FrameTitle>{T.list.title}</FrameTitle>
            <FrameDescription>{T.list.description}</FrameDescription>
          </FrameHeader>
          {data.communities.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.list.name}</TableHead>
                  <TableHead>{T.list.anchor}</TableHead>
                  <TableHead>{T.list.joinMode}</TableHead>
                  <TableHead className="text-end">{T.list.members}</TableHead>
                  <TableHead>{T.list.state}</TableHead>
                  <TableHead className="sr-only">{T.list.edit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.communities.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.name ?? T.list.unnamed}
                      {c.pendingRequests ? (
                        <Badge variant="info-light" className="ms-2">
                          {fill(T.list.pending, { count: c.pendingRequests })}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{T.list.anchors[c.anchorType]}</TableCell>
                    <TableCell className="text-xs">{T.list.joinModes[c.joinMode]}</TableCell>
                    <TableCell className="text-end tabular-nums">{c.members}</TableCell>
                    <TableCell>
                      <Badge variant={STATE_BADGE[c.state]}>{T.list.states[c.state]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'config', c })}>
                          {T.list.edit}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'terms', c })}>
                          {T.list.terms}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={c.state !== 'active'}
                          onClick={() => setDialog({ kind: 'invite', c })}
                        >
                          {T.list.invite}
                        </Button>
                        {galaxie ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                suspendCommunityAction({ id: c.id, suspended: c.state !== 'suspended' }),
                              )
                            }
                          >
                            {c.state === 'suspended' ? T.list.reactivate : T.list.suspend}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground border-t p-4 text-sm">{T.list.empty}</p>
          )}
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-col gap-1 p-4">
            <FrameTitle>{T.requests.title}</FrameTitle>
            <FrameDescription>{T.requests.description}</FrameDescription>
          </FrameHeader>
          {data.requests.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.requests.community}</TableHead>
                  <TableHead>{T.requests.profile}</TableHead>
                  <TableHead>{T.requests.at}</TableHead>
                  <TableHead className="sr-only">{T.requests.approve}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{names.get(r.communityId)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.profileId.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{f.date(r.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => decideJoinRequestAction({ id: r.id, approve: true }))}
                        >
                          {T.requests.approve}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => run(() => decideJoinRequestAction({ id: r.id, approve: false }))}
                        >
                          {T.requests.reject}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground border-t p-4 text-sm">{T.requests.empty}</p>
          )}
        </FramePanel>
      </Frame>

      {dialog?.kind === 'config' ? (
        <ConfigDialog c={dialog.c} pending={pending} run={run} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'terms' ? (
        <TermsDialog c={dialog.c} pending={pending} run={run} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'invite' ? (
        <InviteDialog c={dialog.c} pending={pending} run={run} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

type Run = (action: () => Promise<CommunityActionResult>, after?: (r: CommunityActionResult) => void) => void;

function ConfigDialog({
  c,
  pending,
  run,
  onClose,
}: {
  c: CommunityView;
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.communities;
  const [joinMode, setJoinMode] = useState(c.joinMode);
  const [memberPosts, setMemberPosts] = useState(c.memberPosts);
  const [chatEnabled, setChatEnabled] = useState(c.chatEnabled);
  const [historyDays, setHistoryDays] = useState(c.historyDays === null ? '' : String(c.historyDays));
  const name = c.name ?? T.list.unnamed;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fill(T.config.title, { name })}</DialogTitle>
          <DialogDescription>{T.config.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{T.config.joinMode}</FieldLabel>
            <Select value={joinMode} onValueChange={(v) => setJoinMode(v as CommunityView['joinMode'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOIN_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {T.list.joinModes[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Switch id="member-posts" checked={memberPosts} onCheckedChange={setMemberPosts} />
            <FieldLabel htmlFor="member-posts">{T.config.memberPosts}</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch id="chat-enabled" checked={chatEnabled} onCheckedChange={setChatEnabled} />
            <FieldLabel htmlFor="chat-enabled">{T.config.chatEnabled}</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="history-days">{T.config.historyDays}</FieldLabel>
            <Input
              id="history-days"
              inputMode="numeric"
              value={historyDays}
              onChange={(e) => setHistoryDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <FieldDescription>{T.config.historyHint}</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {T.config.cancel}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveCommunityConfigAction({
                    id: c.id,
                    version: c.version,
                    joinMode,
                    memberPosts,
                    chatEnabled,
                    historyDays: historyDays === '' ? null : Number(historyDays),
                  }),
                onClose,
              )
            }
          >
            {pending ? <Spinner /> : null}
            {T.config.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TermsDialog({
  c,
  pending,
  run,
  onClose,
}: {
  c: CommunityView;
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.communities;
  const [body, setBody] = useState({ pt: '', es: '', en: '' });
  const name = c.name ?? T.list.unnamed;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{fill(T.terms.title, { name })}</DialogTitle>
          <DialogDescription>{T.terms.description}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {c.termsVersion ? fill(T.terms.current, { version: c.termsVersion }) : T.terms.none}
        </p>
        <FieldGroup>
          {(['pt', 'es', 'en'] as const).map((lang) => (
            <Field key={lang}>
              <FieldLabel htmlFor={`terms-${lang}`}>{T.terms[lang]}</FieldLabel>
              <Textarea
                id={`terms-${lang}`}
                rows={5}
                maxLength={20_000}
                value={body[lang]}
                onChange={(e) => setBody({ ...body, [lang]: e.target.value })}
              />
            </Field>
          ))}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {T.config.cancel}
          </Button>
          <Button
            disabled={pending || !body.pt.trim() || !body.es.trim() || !body.en.trim()}
            onClick={() => run(() => publishTermsAction({ id: c.id, body }), onClose)}
          >
            {pending ? <Spinner /> : null}
            {T.terms.publish}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  c,
  pending,
  run,
  onClose,
}: {
  c: CommunityView;
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.communities;
  const [maxUses, setMaxUses] = useState('');
  const [days, setDays] = useState('7');
  const [code, setCode] = useState<string | null>(null);
  const name = c.name ?? T.list.unnamed;
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fill(T.invite.title, { name })}</DialogTitle>
          <DialogDescription>{T.invite.description}</DialogDescription>
        </DialogHeader>
        {code ? (
          <Field>
            <FieldLabel htmlFor="invite-code">{T.invite.code}</FieldLabel>
            <div className="flex gap-2">
              <Input id="invite-code" readOnly value={code} className="font-mono" />
              <Button
                variant="outline"
                aria-label={T.invite.copy}
                onClick={() => navigator.clipboard.writeText(code).then(() => toast.success(T.invite.copied))}
              >
                <Copy />
              </Button>
            </div>
          </Field>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-uses">{T.invite.maxUses}</FieldLabel>
              <Input
                id="invite-uses"
                inputMode="numeric"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-days">{T.invite.days}</FieldLabel>
              <Input
                id="invite-days"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </Field>
          </FieldGroup>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {T.config.cancel}
          </Button>
          {code ? null : (
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => createInviteAction({ id: c.id, maxUses: num(maxUses), days: num(days) }),
                  (r) => setCode(r.code ?? null),
                )
              }
            >
              {pending ? <Spinner /> : null}
              {T.invite.create}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
