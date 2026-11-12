'use client';

import { Inbox } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import { ExplainEmpty, SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { decideCase } from '@/lib/moderation/queue-actions';
import type { QueueItem } from '@/lib/moderation/queue-data';
import {
  dueState,
  MUTE_HOURS,
  QUEUE_MODULES,
  SUSPEND_DAYS,
  type QueueDecision,
} from '@/lib/moderation/queue-utils';

const NOTE_MAX = 500;
const DUE_VARIANT = { overdue: 'destructive-light', soon: 'warning-light', ok: 'secondary' } as const;
const DESTRUCTIVE: readonly QueueDecision[] = ['remove', 'mute', 'suspend', 'ban'];

export type QueueRow = QueueItem & { decisions: QueueDecision[] };

/**
 * Fila de revisão (#999): os itens da fila única da base (#953), do mais grave, com a sugestão da Cosmos, o prazo e as
 * decisões que o cargo abre neste lugar. Cada decisão confirma num diálogo com o motivo; o servidor confere tudo de novo.
 */
export function ReviewQueue({ items, module }: { items: QueueRow[]; module: string | null }) {
  const { t, locale } = useI18n();
  const T = t.moderation.queue;
  const cats = t.moderation.history.categories;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const [deciding, setDeciding] = useState<{ item: QueueRow; decision: QueueDecision } | null>(null);
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState<number>(MUTE_HOURS[0]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const now = Date.now();

  const setModule = (value: string) => {
    const p = new URLSearchParams(search.toString());
    if (value === 'all') p.delete('module');
    else p.set('module', value);
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const open = (item: QueueRow, decision: QueueDecision) => {
    setNote('');
    setDuration(decision === 'suspend' ? SUSPEND_DAYS[0] : MUTE_HOURS[0]);
    setDeciding({ item, decision });
  };

  const confirm = () =>
    deciding &&
    startTransition(async () => {
      const r = await decideCase({
        caseId: deciding.item.id,
        decision: deciding.decision,
        ...(deciding.decision === 'mute' || deciding.decision === 'suspend' ? { duration } : {}),
        ...(note.trim() ? { note } : {}),
      });
      if (!r.ok) toast.error(r.error);
      else toast.success(T.done);
      setDeciding(null);
      router.refresh();
    });

  const label = (c: string) => (cats as Record<string, string>)[c] ?? c;

  const suggestion = (item: QueueRow) => {
    const s = item.suggestion;
    if (!s) return null;
    const S = T.suggestion;
    const by = s.by === 'filter' ? S.filter : s.by === 'classifier' ? S.classifier : S.cosmos;
    let text: string;
    if (s.by === 'filter')
      text = fill(S.noModel, {
        reason: (T.fallback as Record<string, string>)[s.fallback ?? 'other'] ?? T.fallback.other,
      });
    else if (s.actions === 'allow') text = S.allow;
    else
      text = fill(S.actions, {
        actions: s.actions
          .map((a) => {
            const name = (T.actionNames as Record<string, string>)[a] ?? a;
            const step = s.steps[a] ? (S.steps as Record<string, string>)[s.steps[a]] : null;
            return step ? fill(S.stepOf, { action: name, step }) : name;
          })
          .join(', '),
      });
    return (
      <div className="bg-muted/50 flex flex-col gap-1 rounded-md p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {S.title} · {by}
          </span>
          {s.category ? <Badge variant="info-light">{label(s.category)}</Badge> : null}
          {s.severity !== null ? (
            <span className="text-muted-foreground">{fill(T.severity, { value: s.severity })}</span>
          ) : null}
          {s.level !== null ? (
            <span className="text-muted-foreground">{fill(S.level, { level: s.level })}</span>
          ) : null}
          {s.credits ? (
            <span className="text-muted-foreground">{fill(S.credits, { credits: s.credits })}</span>
          ) : null}
        </div>
        <p>{text}</p>
        {s.reason ? <p className="text-muted-foreground">{s.reason}</p> : null}
      </div>
    );
  };

  const row = (item: QueueRow) => {
    const due = dueState(item.dueAt, now);
    const place = item.room
      ? fill(T.place.room, { name: item.room })
      : item.community
        ? fill(T.place.community, { name: item.community })
        : null;
    return (
      <li key={item.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {(T.sources as Record<string, string>)[item.source] ?? item.source}
          </Badge>
          <Badge variant="outline">{(T.modules as Record<string, string>)[item.module] ?? item.module}</Badge>
          {place ? <span className="text-muted-foreground text-xs">{place}</span> : null}
          {item.reasons.map((r) => (
            <Badge key={r} variant="warning-light">
              {label(r)}
            </Badge>
          ))}
          <Badge variant={item.hidden ? 'destructive-light' : 'success-light'} className="ml-auto">
            {item.hidden ? T.hidden : T.visible}
          </Badge>
        </div>
        {item.content ? (
          <p className="break-words whitespace-pre-line">{item.content}</p>
        ) : (
          <p className="text-muted-foreground italic">{T.noContent}</p>
        )}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {item.hasAuthor ? <span>{fill(T.author, { name: item.author ?? T.unknownAuthor })}</span> : null}
          {item.reportCount > 0 ? <span>{fill(T.reports, { count: item.reportCount })}</span> : null}
          <span>{fill(T.opened, { date: when.format(new Date(item.createdAt)) })}</span>
          {due && item.dueAt ? (
            <Badge variant={DUE_VARIANT[due]}>
              {fill(T.due[due], { date: when.format(new Date(item.dueAt)) })}
            </Badge>
          ) : null}
        </div>
        {suggestion(item)}
        {item.decisions.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {item.decisions.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={d === 'approve' ? 'default' : DESTRUCTIVE.includes(d) ? 'outline' : 'secondary'}
                disabled={pending}
                onClick={() => open(item, d)}
              >
                {T.decisions[d]}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{T.readOnly}</p>
        )}
      </li>
    );
  };

  const d = deciding?.decision;
  const options = d === 'mute' ? MUTE_HOURS : d === 'suspend' ? SUSPEND_DAYS : null;

  return (
    <SettingsSection
      title={T.title}
      description={T.description}
      action={
        <Select value={module ?? 'all'} onValueChange={(v) => setModule(String(v ?? 'all'))}>
          <SelectTrigger aria-label={T.moduleFilter} className="w-44">
            <SelectValue>
              {(v: string) => (v === 'all' ? T.allModules : (T.modules as Record<string, string>)[v])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{T.allModules}</SelectItem>
            {QUEUE_MODULES.map((m) => (
              <SelectItem key={m} value={m}>
                {T.modules[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {items.length === 0 ? (
        <ExplainEmpty icon={Inbox} title={T.title} description={T.empty} className="rounded-xl border" />
      ) : (
        <ul className="flex flex-col gap-2">{items.map(row)}</ul>
      )}

      <Dialog open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent>
          {d ? (
            <>
              <DialogHeader>
                <DialogTitle>{T.decisions[d]}</DialogTitle>
                <DialogDescription>{T.decisionHelp[d]}</DialogDescription>
              </DialogHeader>
              {options ? (
                <Field>
                  <FieldLabel htmlFor={`${ids}-duration`}>{T.duration}</FieldLabel>
                  <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                    <SelectTrigger id={`${ids}-duration`}>
                      <SelectValue>
                        {(v: string) => fill(d === 'mute' ? T.hours : T.days, { count: Number(v) })}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o} value={String(o)}>
                          {fill(d === 'mute' ? T.hours : T.days, { count: o })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${ids}-note`}>{T.note}</FieldLabel>
                <Textarea
                  id={`${ids}-note`}
                  value={note}
                  maxLength={NOTE_MAX}
                  placeholder={T.notePlaceholder}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeciding(null)} disabled={pending}>
                  {T.cancel}
                </Button>
                <Button
                  variant={DESTRUCTIVE.includes(d) ? 'destructive' : 'default'}
                  onClick={confirm}
                  disabled={pending}
                >
                  {T.confirm}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
