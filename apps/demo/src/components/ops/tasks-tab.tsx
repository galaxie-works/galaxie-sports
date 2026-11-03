'use client';

/**
 * Seção Tarefas (Ajustes → Sistema): a fila de tarefas por estado, o detalhe de cada uma (checkpoint, prévia, log e
 * execuções), os botões cancelar, reprocessar e "Aprovar e executar", e o formulário de enfileirar com os params
 * pelo schema do tipo. A regra mora no servidor (task-actions.ts → @galaxie/db/queue-admin); aqui só se desenha.
 */
import { CheckCircle2, Eye, ListPlus, RotateCcw, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  approveTaskAction,
  cancelTaskAction,
  enqueueTask,
  loadTask,
  reprocessTaskAction,
  type TaskActionResult,
} from '@/app/[locale]/(app)/ajustes/operacao/task-actions';
import { Badge } from '@/components/reui/badge';
import { CodeBlock } from '@/components/reui/code-block/code-block';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
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
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type {
  OpsTasks,
  TaskDetailView,
  TaskListItem,
  TaskParamFieldView,
  TaskStateView,
  TaskTypeView,
} from '@/lib/ops/types';

/** Filtros da lista, na ordem dos botões. */
export const TASK_FILTERS = [
  'all',
  'awaiting',
  'pendente',
  'retomada',
  'rodando',
  'falha',
  'concluida',
  'cancelada',
] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export function matchesFilter(item: TaskListItem, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'awaiting') return item.awaitingApproval;
  return item.state === filter;
}

const STATE_VARIANT: Record<
  TaskStateView,
  'secondary' | 'info-light' | 'warning-light' | 'success-light' | 'destructive-light'
> = {
  pendente: 'secondary',
  retomada: 'warning-light',
  rodando: 'info-light',
  concluida: 'success-light',
  falha: 'destructive-light',
  cancelada: 'secondary',
  outro: 'secondary',
};

const RUN_VARIANT: Record<string, 'info-light' | 'warning-light' | 'success-light' | 'destructive-light'> = {
  running: 'info-light',
  interrupted: 'warning-light',
  ok: 'success-light',
  error: 'destructive-light',
};

/** Roda uma ação da fila com toast e atualiza a página. */
function useTaskAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const run = (
    fn: () => Promise<TaskActionResult>,
    ok: (res: TaskActionResult) => string,
    after?: (res: TaskActionResult) => void,
  ) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? t.ops.tasks.errors.unknown, {
          description: res.issues?.join(' · '),
        });
        return;
      }
      toast.success(ok(res));
      after?.(res);
      router.refresh();
    });
  return { pending, run };
}

export function TaskStateBadge({ item }: { item: TaskListItem }) {
  const { t } = useI18n();
  const T = t.ops.tasks;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={STATE_VARIANT[item.state]}>{T.states[item.state]}</Badge>
      {item.awaitingApproval ? <Badge variant="warning-outline">{T.awaitingBadge}</Badge> : null}
    </span>
  );
}

function ProgressCell({ item }: { item: TaskListItem }) {
  const { t } = useI18n();
  const p = item.progress;
  if (!p) return <span className="text-muted-foreground">—</span>;
  if (p.total === null || p.total === 0) return <span className="tabular-nums">{p.feitos}</span>;
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <Progress value={Math.min(100, (p.feitos / p.total) * 100)} />
      <span className="text-muted-foreground text-[11px] tabular-nums">
        {fill(t.ops.tasks.progressOf, { done: p.feitos, total: p.total })}
      </span>
    </div>
  );
}

export function TasksTab({
  tasks,
  timeZone,
  now,
}: {
  tasks: OpsTasks | null;
  timeZone: string;
  /** Instante da leitura (ISO): base dos "há X min" (igual no servidor e na hidratação). */
  now: string;
}) {
  const { t } = useI18n();
  const T = t.ops.tasks;
  const f = useFormatters(timeZone);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [enqueueOpen, setEnqueueOpen] = useState(false);

  if (!tasks)
    return (
      <Frame>
        <FramePanel className="p-4">
          <p className="text-muted-foreground text-sm">{T.unavailable}</p>
        </FramePanel>
      </Frame>
    );

  const at = Date.parse(now);
  const visible = tasks.items.filter((i) => matchesFilter(i, filter));
  const count = (id: TaskFilter) => tasks.items.filter((i) => matchesFilter(i, id)).length;

  return (
    <Frame>
      <FramePanel className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
          <FrameHeader className="p-0">
            <FrameTitle>{T.title}</FrameTitle>
            <FrameDescription>{T.description}</FrameDescription>
          </FrameHeader>
          <Button size="sm" onClick={() => setEnqueueOpen(true)} disabled={!tasks.types.length}>
            <ListPlus />
            {T.enqueue}
          </Button>
        </div>
        <div className="px-4 py-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[filter]}
            onValueChange={(next) => next[0] && setFilter(next[0] as TaskFilter)}
            className="flex-wrap"
            aria-label={T.columns.state}
          >
            {TASK_FILTERS.map((id) => (
              <ToggleGroupItem
                key={id}
                value={id}
                className="data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
              >
                {T.filters[id]}
                <span className="tabular-nums opacity-70">{count(id)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {visible.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{T.columns.type}</TableHead>
                <TableHead>{T.columns.state}</TableHead>
                <TableHead className="text-right">{T.columns.priority}</TableHead>
                <TableHead className="text-right">{T.columns.attempts}</TableHead>
                <TableHead>{T.columns.age}</TableHead>
                <TableHead>{T.columns.worker}</TableHead>
                <TableHead>{T.columns.progress}</TableHead>
                <TableHead className="pr-4 text-right">{T.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <TableRow key={item.id} data-task={item.id}>
                  <TableCell className="pl-4 align-top">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        {item.type}
                        {item.previa ? <Badge variant="info-outline">{T.previewBadge}</Badge> : null}
                        {item.previaId ? <Badge variant="primary-light">{T.approvedBadge}</Badge> : null}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">{item.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <TaskStateBadge item={item} />
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">{item.priority}</TableCell>
                  <TableCell className="text-right align-top tabular-nums">
                    {item.attempts}/{item.maxAttempts}
                  </TableCell>
                  <TableCell
                    className="align-top text-xs whitespace-nowrap"
                    title={f.dateTime(item.requestedAt)}
                  >
                    {f.relative(item.requestedAt, at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top font-mono text-[11px]">
                    {item.lockedBy ?? '—'}
                  </TableCell>
                  <TableCell className="align-top text-xs">
                    <ProgressCell item={item} />
                  </TableCell>
                  <TableCell className="pr-4 text-right align-top">
                    <Button variant="outline" size="sm" onClick={() => setSelected(item.id)}>
                      <Eye />
                      {T.view}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground px-4 pb-4 text-sm">
            {tasks.items.length ? T.emptyFilter : T.empty}
          </p>
        )}
        {tasks.items.length >= 100 ? (
          <p className="text-muted-foreground px-4 pb-4 text-xs">
            {fill(T.limit, { n: tasks.items.length })}
          </p>
        ) : null}
      </FramePanel>
      <TaskSheet id={selected} onClose={() => setSelected(null)} onOpen={setSelected} timeZone={timeZone} />
      <EnqueueDialog
        types={tasks.types}
        open={enqueueOpen}
        onOpenChange={setEnqueueOpen}
        onCreated={(id) => setSelected(id)}
      />
    </Frame>
  );
}

// ── detalhe ───────────────────────────────────────────────────────────────────────────────────

function TaskSheet({
  id,
  onClose,
  onOpen,
  timeZone,
}: {
  id: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.ops.tasks;
  const [task, setTask] = useState<TaskDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const reload = useCallback(
    (target: string) =>
      startLoading(async () => {
        const res = await loadTask(target);
        if ('task' in res) {
          setTask(res.task);
          setError(null);
        } else {
          setTask(null);
          setError(res.error ?? T.errors.unknown);
        }
      }),
    [T.errors.unknown],
  );

  useEffect(() => {
    if (id) reload(id);
    else setTask(null);
  }, [id, reload]);

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono">
            {task ? fill(T.detail.title, { type: task.type }) : T.detail.loading}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">{id}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          {task ? (
            <TaskDetailBody task={task} timeZone={timeZone} onChanged={reload} onOpen={onOpen} />
          ) : loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Spinner /> {T.detail.loading}
            </div>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

export function TaskDetailBody({
  task,
  timeZone,
  onChanged,
  onOpen,
}: {
  task: TaskDetailView;
  timeZone: string;
  /** Recarrega o detalhe depois de uma ação. */
  onChanged: (id: string) => void;
  /** Abre outra tarefa (execução aprovada, reprocessamento, prévia de origem). */
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const T = t.ops.tasks;
  const f = useFormatters(timeZone);
  const { pending, run } = useTaskAction();
  const params = Object.entries(task.params);
  const linked = (l: TaskDetailView['approvals'][number]) => (
    <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
      <Button variant="link" size="sm" className="h-auto p-0 font-mono" onClick={() => onOpen(l.id)}>
        {l.id}
      </Button>
      <span className="text-muted-foreground">
        {fill(T.detail.linked, {
          status: T.states[stateOfStatus(l.status)],
          who: l.requestedBy,
          when: f.dateTime(l.requestedAt),
        })}
      </span>
    </li>
  );

  return (
    <>
      <div className="flex flex-col gap-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <TaskStateBadge item={task} />
          {task.previa ? <Badge variant="info-outline">{T.previewBadge}</Badge> : null}
        </div>
        <span className="text-muted-foreground">
          {fill(T.detail.requested, { when: f.dateTime(task.requestedAt), who: task.requestedBy })}
          {' · '}
          {fill(T.detail.attempts, { n: task.attempts, max: task.maxAttempts })}
        </span>
        {task.lockedBy ? (
          <span className="text-muted-foreground">
            {fill(T.detail.worker, {
              worker: task.lockedBy,
              until: task.lockedUntil ? f.time(task.lockedUntil) : '—',
            })}
          </span>
        ) : null}
        {task.finishedAt ? (
          <span className="text-muted-foreground">
            {fill(T.detail.finished, { when: f.dateTime(task.finishedAt) })}
          </span>
        ) : null}
        {task.previaId ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto justify-start p-0 text-xs"
            onClick={() => onOpen(task.previaId!)}
          >
            {fill(T.detail.approvedFrom, { id: task.previaId })}
          </Button>
        ) : null}
        {task.reprocessaDe ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto justify-start p-0 text-xs"
            onClick={() => onOpen(task.reprocessaDe!)}
          >
            {fill(T.detail.reprocessOf, { id: task.reprocessaDe })}
          </Button>
        ) : null}
        {task.detail ? (
          <span>
            <span className="text-muted-foreground">{T.detail.detail}: </span>
            {task.detail}
          </span>
        ) : null}
        {task.lastError && task.lastError !== task.detail ? (
          <code className="text-destructive font-mono text-[11px] break-all">
            {T.detail.lastError}: {task.lastError}
          </code>
        ) : null}
      </div>

      <TaskActions task={task} pending={pending} run={run} onChanged={onChanged} onOpen={onOpen} />

      <Section title={T.detail.params}>
        {params.length ? (
          <dl className="divide-y rounded-md border text-xs">
            {params.map(([k, v]) => (
              <div key={k} className="flex gap-3 px-3 py-1.5">
                <dt className="text-muted-foreground w-32 shrink-0 font-mono">{k}</dt>
                <dd className="min-w-0 font-mono break-all">
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground text-xs">{T.detail.noParams}</p>
        )}
      </Section>

      {task.previa ? (
        <Section title={T.detail.preview}>
          {task.preview ? (
            <div className="flex flex-col gap-2 text-xs">
              <p className="text-muted-foreground">{T.detail.previewHint}</p>
              {task.preview.resumo ? <p>{task.preview.resumo}</p> : null}
              {Object.keys(task.preview.contagens).length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{T.detail.counts}</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(task.preview.contagens).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell className="font-mono text-xs">{k}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.number(v)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              {task.preview.amostra.length ? (
                <>
                  <span className="text-muted-foreground">{T.detail.sample}</span>
                  <CodeBlock code={json(task.preview.amostra)} language="json" maxLines={15} />
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">{T.detail.previewPending}</p>
          )}
        </Section>
      ) : null}

      {task.progress ? (
        <Section title={T.detail.progress}>
          <div className="flex flex-col gap-1 text-xs">
            {task.progress.total ? (
              <Progress value={Math.min(100, (task.progress.feitos / task.progress.total) * 100)} />
            ) : null}
            <span className="tabular-nums">
              {task.progress.total !== null
                ? fill(T.progressOf, { done: task.progress.feitos, total: task.progress.total })
                : task.progress.feitos}
              {task.progress.lote ? ` · ${fill(T.detail.batch, { batch: task.progress.lote })}` : ''}
            </span>
          </div>
        </Section>
      ) : null}

      {task.log.length ? (
        <Section title={T.detail.log}>
          <pre className="bg-muted/50 max-h-60 overflow-auto rounded-md border p-2 font-mono text-[11px] whitespace-pre-wrap">
            {task.log.join('\n')}
          </pre>
        </Section>
      ) : null}

      {task.approvals.length ? (
        <Section title={T.detail.approvals}>
          <ul className="flex flex-col gap-1">{task.approvals.map(linked)}</ul>
        </Section>
      ) : null}
      {task.reprocesses.length ? (
        <Section title={T.detail.reprocesses}>
          <ul className="flex flex-col gap-1">{task.reprocesses.map(linked)}</ul>
        </Section>
      ) : null}

      <Section title={T.detail.runs}>
        {task.runs.length ? (
          <Table>
            <TableBody>
              {task.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{f.dateTime(r.startedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={RUN_VARIANT[r.status] ?? 'secondary'}>
                      {t.ops.jobs.status[r.status as keyof typeof t.ops.jobs.status] ?? r.status}
                    </Badge>
                    {r.resumed ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">{T.detail.resumed}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[11px]">
                    {r.worker ?? ''}
                  </TableCell>
                  <TableCell className="max-w-56 text-xs whitespace-normal">
                    {r.error ? (
                      <code className="text-destructive font-mono text-[11px] break-all">{r.error}</code>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-xs">{T.detail.noRuns}</p>
        )}
      </Section>

      <Section title={T.detail.checkpoint}>
        {task.checkpoint !== null && task.checkpoint !== undefined ? (
          <CodeBlock code={json(task.checkpoint)} language="json" maxLines={20} />
        ) : (
          <p className="text-muted-foreground text-xs">{T.detail.noCheckpoint}</p>
        )}
      </Section>
    </>
  );
}

/** Estado de exibição a partir do status do banco (para as tarefas ligadas, que não trazem o run_id). */
function stateOfStatus(status: string): TaskStateView {
  return (
    (
      {
        pending: 'pendente',
        running: 'rodando',
        done: 'concluida',
        error: 'falha',
        canceled: 'cancelada',
      } as const
    )[status as 'pending'] ?? 'outro'
  );
}

function ConfirmButton({
  label,
  title,
  body,
  icon,
  variant = 'outline',
  disabled,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  variant?: 'outline' | 'default' | 'destructive';
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant={variant} size="sm" disabled={disabled} />}>
        {icon}
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.ops.tasks.actions.back}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TaskActions({
  task,
  pending,
  run,
  onChanged,
  onOpen,
}: {
  task: TaskDetailView;
  pending: boolean;
  run: ReturnType<typeof useTaskAction>['run'];
  onChanged: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const T = t.ops.tasks;
  const A = T.actions;
  const canCancel = task.status === 'pending';
  const canReprocess = task.status !== 'pending' && task.status !== 'running';
  if (!canCancel && !canReprocess && !task.awaitingApproval) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {task.awaitingApproval ? (
        <ConfirmButton
          label={A.approve}
          title={fill(A.approveTitle, { type: task.type })}
          body={A.approveBody}
          icon={<CheckCircle2 />}
          variant="default"
          disabled={pending}
          onConfirm={() =>
            run(
              () => approveTaskAction(task.id),
              () => T.feedback.approved,
              (res) => (res.id ? onOpen(res.id) : onChanged(task.id)),
            )
          }
        />
      ) : null}
      {canCancel ? (
        <ConfirmButton
          label={A.cancel}
          title={fill(A.cancelTitle, { type: task.type })}
          body={A.cancelBody}
          icon={<XCircle />}
          variant="destructive"
          disabled={pending}
          onConfirm={() =>
            run(
              () => cancelTaskAction(task.id),
              () => T.feedback.canceled,
              () => onChanged(task.id),
            )
          }
        />
      ) : null}
      {canReprocess ? (
        <ConfirmButton
          label={A.reprocess}
          title={fill(A.reprocessTitle, { type: task.type })}
          body={task.destrutiva && !task.previa ? A.reprocessPreviewBody : A.reprocessBody}
          icon={<RotateCcw />}
          disabled={pending}
          onConfirm={() =>
            run(
              () => reprocessTaskAction(task.id),
              (res) => (res.previa ? T.feedback.previewQueued : T.feedback.reprocessed),
              (res) => (res.id ? onOpen(res.id) : onChanged(task.id)),
            )
          }
        />
      ) : null}
    </div>
  );
}

// ── enfileirar ────────────────────────────────────────────────────────────────────────────────

const defaultText = (field: TaskParamFieldView) =>
  field.default === null || field.default === undefined
    ? ''
    : typeof field.default === 'string'
      ? field.default
      : JSON.stringify(field.default);

function ParamInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: TaskParamFieldView;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = `task-param-${field.name}`;
  if (field.kind === 'boolean')
    return (
      <Switch
        id={id}
        checked={value === 'true'}
        onCheckedChange={(c) => onChange(c ? 'true' : 'false')}
        disabled={disabled}
      />
    );
  if (field.kind === 'enum') {
    const items = (field.options ?? []).map((o) => ({ value: o, label: o }));
    return (
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => onChange(next ? String(next) : '')}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
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
  if (field.kind === 'json')
    return (
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="font-mono text-xs"
        rows={3}
      />
    );
  return (
    <Input
      id={id}
      type={field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'}
      step={field.kind === 'integer' ? 1 : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

const defaultsFor = (def: TaskTypeView | null): Record<string, string> =>
  def ? Object.fromEntries(def.fields.map((fd) => [fd.name, defaultText(fd)])) : {};

export function EnqueueDialog({
  types,
  open,
  onOpenChange,
  onCreated,
}: {
  types: TaskTypeView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre o detalhe da criada. */
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const T = t.ops.tasks;
  const F = T.form;
  const [type, setType] = useState(types[0]?.type ?? '');
  const def = types.find((d) => d.type === type) ?? null;
  const [values, setValues] = useState<Record<string, string>>(() => defaultsFor(def));
  const [priority, setPriority] = useState('0');
  const [previa, setPrevia] = useState(def?.destrutiva ?? false);
  const [issues, setIssues] = useState<string[]>([]);
  const { pending, run } = useTaskAction();

  // tipo novo: os padrões do schema e a prévia obrigatória do destrutivo (no clique, não num efeito: a lista de
  // tipos chega de novo a cada atualização da página e não pode apagar o que já foi digitado)
  const chooseType = (next: string) => {
    const chosen = types.find((d) => d.type === next) ?? null;
    setType(next);
    setValues(defaultsFor(chosen));
    setPrevia(chosen?.destrutiva ?? false);
    setIssues([]);
  };

  const submit = () =>
    run(
      async () => {
        const res = await enqueueTask({
          type,
          params: values,
          priority: Number(priority) || 0,
          previa: def?.destrutiva ? true : previa,
        });
        setIssues(res.ok ? [] : (res.issues ?? []));
        return res;
      },
      (res) => (res.previa ? T.feedback.previewQueued : T.feedback.queued),
      (res) => {
        onOpenChange(false);
        if (res.id) onCreated(res.id);
      },
    );

  const typeItems = types.map((d) => ({ value: d.type, label: d.type }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{F.title}</DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        {types.length ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="task-type">{F.type}</FieldLabel>
                <Select
                  items={typeItems}
                  value={type}
                  onValueChange={(next) => next && chooseType(String(next))}
                  disabled={pending}
                >
                  <SelectTrigger id="task-type" className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeItems.map((i) => (
                      <SelectItem key={i.value} value={i.value} className="font-mono">
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {def ? (
                  <FieldDescription>
                    {def.descricao}
                    {def.destrutiva ? (
                      <Badge variant="destructive-light" className="ml-1.5">
                        {T.destructiveBadge}
                      </Badge>
                    ) : null}
                  </FieldDescription>
                ) : null}
              </Field>
              {def?.fields.map((field) => (
                <Field key={`${def.type}:${field.name}`}>
                  <FieldLabel htmlFor={`task-param-${field.name}`} className="font-mono">
                    {field.name}
                    {field.required ? null : (
                      <span className="text-muted-foreground font-sans font-normal">({F.optional})</span>
                    )}
                  </FieldLabel>
                  <ParamInput
                    field={field}
                    value={values[field.name] ?? ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                    disabled={pending}
                  />
                  {field.description || field.default !== null || field.kind === 'json' ? (
                    <FieldDescription>
                      {[
                        field.description,
                        field.default !== null ? fill(F.defaultValue, { value: defaultText(field) }) : null,
                        field.kind === 'json' ? F.json : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </FieldDescription>
                  ) : null}
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor="task-priority">{F.priority}</FieldLabel>
                <Input
                  id="task-priority"
                  type="number"
                  step={1}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  disabled={pending}
                />
                <FieldDescription>{F.priorityHint}</FieldDescription>
              </Field>
              {def ? (
                <Field orientation="horizontal">
                  <Switch
                    id="task-previa"
                    checked={def.destrutiva || previa}
                    onCheckedChange={setPrevia}
                    disabled={pending || def.destrutiva || !def.previa}
                  />
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor="task-previa">{F.preview}</FieldLabel>
                    <FieldDescription>
                      {def.destrutiva ? F.previewRequired : def.previa ? F.previewHint : F.noPreview}
                    </FieldDescription>
                  </div>
                </Field>
              ) : null}
              {issues.length ? (
                <FieldError>
                  <ul className="list-disc pl-4">
                    {issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </FieldError>
              ) : null}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                {F.cancel}
              </Button>
              <Button type="submit" disabled={pending || !def}>
                {pending ? <Spinner /> : <ListPlus />}
                {F.submit}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">{F.noTypes}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
