'use client';

import { MoreHorizontal, Plus, ShieldAlert, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  replayWebhookDead,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookActive,
  type DeliveryRow,
  type WebhookActionResult,
} from '@/app/[locale]/(app)/cliente/webhooks/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { ActionNotice, ExplainEmpty, SettingsSection, UsageMeter } from '@/components/settings';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { CodeSnippet } from './code-snippet';

export interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  topics: string[];
  filters: { events?: string[]; competitions?: string[]; sports?: string[] };
  active: boolean;
  createdAt: string;
  pending: number;
  dead: number;
  delivered24h: number;
  lastDeliveredAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

/** Tópico completo → nome curto (o mesmo de `?topics=` na API e da CLI). */
const TOPICS = [
  ['event.score_changed', 'score'],
  ['event.status_changed', 'status'],
  ['event.incident_added', 'incidents'],
  ['where_to_watch.changed', 'where_to_watch'],
  ['event.context_published', 'context'],
  ['event.related_content_changed', 'related'],
] as const;
type ShortTopic = (typeof TOPICS)[number][1];
const SHORT = new Map<string, ShortTopic>(TOPICS);

const SECRET_ENV = 'GALAXIE_WEBHOOK_SECRET';

/** Mostra o segredo uma única vez (cadastro ou rotação). */
function SecretView({ secret, onDone }: { secret: string; onDone: () => void }) {
  const { t } = useI18n();
  const w = t.webhooks;
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription>{w.onceWarning}</AlertDescription>
      </Alert>
      <CodeSnippet code={secret} />
      <p className="text-muted-foreground text-sm">{w.secretEnv}</p>
      <CodeSnippet code={`${SECRET_ENV}=${secret}`} />
      <Link
        href="/docs/tempo-real#webhooks"
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        {w.docsLink}
      </Link>
      <DialogFooter>
        <Button onClick={onDone}>{w.done}</Button>
      </DialogFooter>
    </div>
  );
}

function CreateWebhookDialog({ topicsInPlan, disabled }: { topicsInPlan: string[]; disabled: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const w = t.webhooks;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [sports, setSports] = useState('');
  const [competitions, setCompetitions] = useState('');
  const [events, setEvents] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setUrl('');
    setLabel('');
    setTopics([]);
    setSports('');
    setCompetitions('');
    setEvents('');
    setError(null);
    setSecret(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createWebhook({ url, label, topics, sports, competitions, events });
      if (!res.ok || !res.secret) return void setError(res.error ?? w.errors.generic);
      setSecret(res.secret);
      router.refresh();
    });
  }

  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <Plus />
        {w.create}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{secret ? w.secretTitle : w.createTitle}</DialogTitle>
            <DialogDescription>{w.createDescription}</DialogDescription>
          </DialogHeader>
          {secret ? (
            <SecretView
              secret={secret}
              onDone={() => {
                setOpen(false);
                reset();
              }}
            />
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="wh-url">{w.url}</FieldLabel>
                  <Input
                    id="wh-url"
                    type="url"
                    required
                    autoFocus
                    inputMode="url"
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder={w.urlPlaceholder}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <FieldDescription>{w.urlHint}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="wh-label">{w.label}</FieldLabel>
                  <Input
                    id="wh-label"
                    maxLength={120}
                    placeholder={w.labelPlaceholder}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </Field>
                <FieldSet>
                  <FieldLegend variant="label">{w.topics}</FieldLegend>
                  <FieldDescription>{w.topicsHint}</FieldDescription>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TOPICS.map(([full, short]) => {
                      const inPlan = topicsInPlan.includes(full);
                      return (
                        <Field key={full} orientation="horizontal" data-disabled={!inPlan || undefined}>
                          <Checkbox
                            id={`wh-topic-${short}`}
                            disabled={!inPlan}
                            checked={topics.includes(full)}
                            onCheckedChange={(v) =>
                              setTopics((cur) =>
                                v === true ? [...cur, full] : cur.filter((x) => x !== full),
                              )
                            }
                          />
                          <FieldLabel htmlFor={`wh-topic-${short}`} className="font-normal">
                            {w.topicNames[short]}
                            {inPlan ? null : (
                              <span className="text-muted-foreground text-xs">({w.outsidePlan})</span>
                            )}
                          </FieldLabel>
                        </Field>
                      );
                    })}
                  </div>
                </FieldSet>
                <FieldSet>
                  <FieldLegend variant="label">{w.filters}</FieldLegend>
                  <FieldDescription>{w.filtersHint}</FieldDescription>
                  <Field>
                    <FieldLabel htmlFor="wh-sports">{w.sports}</FieldLabel>
                    <Input
                      id="wh-sports"
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder={w.sportsPlaceholder}
                      value={sports}
                      onChange={(e) => setSports(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="wh-competitions">{w.competitions}</FieldLabel>
                    <Input
                      id="wh-competitions"
                      spellCheck={false}
                      className="font-mono text-xs"
                      value={competitions}
                      onChange={(e) => setCompetitions(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="wh-events">{w.events}</FieldLabel>
                    <Input
                      id="wh-events"
                      spellCheck={false}
                      className="font-mono text-xs"
                      value={events}
                      onChange={(e) => setEvents(e.target.value)}
                    />
                  </Field>
                </FieldSet>
              </FieldGroup>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner /> : <Webhook />}
                  {w.submit}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Entregas do diálogo do histórico: carregadas no clique que abre o diálogo (nunca durante a renderização). */
function useDeliveries(id: string) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const load = () =>
    startTransition(async () => {
      setRows(null);
      setError(null);
      const res = await listWebhookDeliveries(id);
      if (!res.ok) setError(res.error ?? t.webhooks.errors.generic);
      else setRows(res.rows ?? []);
    });
  return { rows, error, load };
}

function DeliveriesDialog({
  row,
  open,
  onOpenChange,
  rows,
  error,
  timeZone,
}: {
  row: WebhookRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: DeliveryRow[] | null;
  error: string | null;
  timeZone: string;
}) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const h = t.webhooks.history;

  const tone = (s: DeliveryRow['status']) =>
    s === 'delivered' ? 'success-light' : s === 'dead' ? 'destructive-light' : 'warning-light';
  const result = (d: DeliveryRow) =>
    d.status === 'pending' && d.attempts > 0
      ? `${d.lastError ?? ''} · ${fill(h.retryAt, { when: f.relative(d.nextRetryAt) })}`
      : d.status === 'delivered'
        ? `HTTP ${d.responseCode ?? 200}`
        : (d.lastError ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{h.title}</DialogTitle>
          <DialogDescription className="break-all">{fill(h.description, { url: row.url })}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : rows === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : rows.length ? (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{h.when}</TableHead>
                  <TableHead>{h.topic}</TableHead>
                  <TableHead>{h.status}</TableHead>
                  <TableHead className="text-right">{h.attempts}</TableHead>
                  <TableHead>{h.result}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {f.dateTime(d.lastAttemptAt ?? d.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.topic}</TableCell>
                    <TableCell>
                      <Badge variant={tone(d.status)} radius="full">
                        {h.statuses[d.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.attempts}</TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate text-xs" title={result(d)}>
                      {result(d)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground py-6 text-sm">{h.empty}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Confirm = 'rotate' | 'remove' | null;

function RowActions({
  row,
  available,
  canDeliver,
  timeZone,
}: {
  row: WebhookRow;
  available: boolean;
  /** Plano com tempo real: sem ele o worker não envia, então não há teste. */
  canDeliver: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const a = t.webhooks.actions;
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [history, setHistory] = useState(false);
  const deliveries = useDeliveries(row.id);
  const [secret, setSecret] = useState<string | null>(null);

  const run = (action: () => Promise<WebhookActionResult>, ok: (r: WebhookActionResult) => string | null) =>
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return void toast.error(res.error ?? t.webhooks.errors.generic);
      const msg = ok(res);
      if (msg) toast.success(msg);
      router.refresh();
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={fill(a.menu, { url: row.url })}
            />
          }
        >
          {pending ? <Spinner /> : <MoreHorizontal />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {row.active && canDeliver ? (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => sendWebhookTest(row.id),
                  () => a.testQueued,
                )
              }
            >
              {a.test}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => {
              deliveries.load();
              setHistory(true);
            }}
          >
            {a.history}
          </DropdownMenuItem>
          {row.dead > 0 ? (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => replayWebhookDead(row.id),
                  (r) => fill(a.replayed, { n: r.count ?? 0 }),
                )
              }
            >
              {a.replay}
            </DropdownMenuItem>
          ) : null}
          {available ? (
            <DropdownMenuItem onClick={() => setConfirm('rotate')}>{a.rotate}</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {row.active ? (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => setWebhookActive(row.id, false),
                  () => a.disabled,
                )
              }
            >
              {a.disable}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                run(
                  () => setWebhookActive(row.id, true),
                  () => a.enabled,
                )
              }
            >
              {a.enable}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm('remove')}>
            {a.remove}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'rotate' ? a.rotateTitle : a.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'rotate' ? a.rotateDescription : a.removeDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{a.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                if (which === 'remove')
                  return run(
                    () => deleteWebhook(row.id),
                    () => a.removed,
                  );
                startTransition(async () => {
                  const res = await rotateWebhookSecret(row.id);
                  if (!res.ok || !res.secret) return void toast.error(res.error ?? t.webhooks.errors.generic);
                  setSecret(res.secret);
                });
              }}
            >
              {confirm === 'rotate' ? a.rotate : a.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.webhooks.rotatedTitle}</DialogTitle>
            <DialogDescription className="break-all">{row.url}</DialogDescription>
          </DialogHeader>
          {secret ? <SecretView secret={secret} onDone={() => setSecret(null)} /> : null}
        </DialogContent>
      </Dialog>

      <DeliveriesDialog
        row={row}
        open={history}
        onOpenChange={setHistory}
        rows={deliveries.rows}
        error={deliveries.error}
        timeZone={timeZone}
      />
    </>
  );
}

/** Webhooks do tenant: cadastrar (o segredo aparece uma vez), testar, ver entregas, reenviar a DLQ e rotacionar. */
export function WebhooksPanel({
  webhooks,
  topicsInPlan,
  planAllows,
  available,
  max,
  timeZone,
}: {
  webhooks: WebhookRow[];
  topicsInPlan: string[];
  planAllows: boolean;
  available: boolean;
  max: number;
  timeZone: string;
}) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const w = t.webhooks;
  const atLimit = webhooks.length >= max;
  const notice = !planAllows ? w.plan : !available ? w.unavailable : atLimit ? fill(w.limit, { max }) : null;
  const topicLabel = (full: string) => {
    const short = SHORT.get(full);
    return short ? w.topicNames[short] : full;
  };

  return (
    <SettingsSection
      title={w.title}
      description={
        <>
          {w.description}{' '}
          <Link href="/docs/tempo-real#webhooks" className="text-primary underline-offset-4 hover:underline">
            {w.docsLink}
          </Link>
        </>
      }
      action={<CreateWebhookDialog topicsInPlan={topicsInPlan} disabled={notice !== null} />}
    >
      {notice ? <ActionNotice tone="info">{notice}</ActionNotice> : null}
      {planAllows && available ? <UsageMeter label={w.usage} used={webhooks.length} total={max} /> : null}
      <Frame>
        <FramePanel className="p-0">
          {webhooks.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{w.columns.endpoint}</TableHead>
                  <TableHead>{w.columns.topics}</TableHead>
                  <TableHead>{w.columns.status}</TableHead>
                  <TableHead>{w.columns.deliveries}</TableHead>
                  <TableHead>{w.columns.lastFailure}</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((row) => (
                  <TableRow key={row.id} className={row.active ? undefined : 'opacity-60'}>
                    <TableCell className="max-w-72 pl-4">
                      <div className="truncate font-mono text-xs" title={row.url}>
                        {row.url}
                      </div>
                      {row.description ? (
                        <div className="text-muted-foreground truncate text-xs">{row.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {row.topics.length ? (
                          row.topics.map((tp) => (
                            <Badge key={tp} variant="outline" className="text-[11px]">
                              {topicLabel(tp)}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-[11px]">
                            {w.allTopics}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.active ? 'success-light' : 'secondary'} radius="full">
                        {row.active ? w.active : w.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col gap-0.5">
                        <span>{fill(w.delivered24h, { n: row.delivered24h })}</span>
                        <span className="text-muted-foreground text-xs">
                          {row.lastDeliveredAt
                            ? fill(w.lastDelivered, { when: f.relative(row.lastDeliveredAt) })
                            : w.neverDelivered}
                        </span>
                        {row.pending || row.dead ? (
                          <div className="flex flex-wrap gap-1">
                            {row.pending ? (
                              <Badge variant="warning-light" radius="full">
                                {fill(w.pending, { n: row.pending })}
                              </Badge>
                            ) : null}
                            {row.dead ? (
                              <Badge variant="destructive-light" radius="full">
                                {fill(w.dead, { n: row.dead })}
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 text-xs">
                      {row.lastFailureAt ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{f.relative(row.lastFailureAt)}</span>
                          <span className="truncate" title={row.lastError ?? undefined}>
                            {row.lastError}
                          </span>
                        </div>
                      ) : (
                        w.noFailures
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <RowActions
                        row={row}
                        available={available}
                        canDeliver={planAllows}
                        timeZone={timeZone}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ExplainEmpty
              icon={Webhook}
              title={w.emptyTitle}
              description={w.empty}
              action={notice ? null : <CreateWebhookDialog topicsInPlan={topicsInPlan} disabled={false} />}
            />
          )}
        </FramePanel>
      </Frame>
    </SettingsSection>
  );
}
