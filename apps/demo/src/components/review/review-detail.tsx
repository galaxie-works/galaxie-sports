'use client';

import { Check, FilePenLine, Undo2, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/reui/badge';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { fieldText, parseProposedField, type ReviewPreview } from '@/lib/review/preview';
import {
  REVIEW_STATUSES,
  floorsFrom,
  servedAt,
  type ReviewDetail as Detail,
  type ServingFloor,
} from '@/lib/review/types';

import { STATE_BADGE, marketLabel, sportLabel } from './labels';
import { useDecide } from './use-decide';

/** Campos que identificam o item: não entram na edição proposta. */
const LOCKED_FIELDS = new Set(['slug', 'key']);

function Value({ value, empty }: { value: unknown; empty: string }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length))
    return <span className="text-muted-foreground italic">{empty}</span>;
  if (Array.isArray(value))
    return (
      <ul className="list-disc space-y-0.5 pl-4">
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} empty={empty} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === 'object')
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground font-mono text-xs leading-5">{k}</dt>
            <dd>
              <Value value={v} empty={empty} />
            </dd>
          </div>
        ))}
      </dl>
    );
  const text = String(value);
  return /^https?:\/\//.test(text) ? (
    <a
      href={text}
      target="_blank"
      rel="noreferrer"
      className="text-primary break-all underline-offset-4 hover:underline"
    >
      {text}
    </a>
  ) : (
    <span className="break-words whitespace-pre-wrap">{text}</span>
  );
}

function Fields({ content, empty }: { content: Record<string, unknown>; empty: string }) {
  return (
    <dl className="divide-y text-sm">
      {Object.entries(content).map(([k, v]) => (
        <div key={k} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr] sm:gap-3">
          <dt className="text-muted-foreground font-mono text-xs leading-5">{k}</dt>
          <dd>
            <Value value={v} empty={empty} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Tradução lado a lado com o original, campo a campo. */
function SideBySide({ item, empty }: { item: Detail; empty: string }) {
  const { t } = useI18n();
  const T = t.review.detail;
  const keys = Object.keys(item.content).filter((k) => k !== 'note');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 pr-3 font-normal" />
            <th className="py-2 pr-3 font-medium">
              {fill(T.original, { locale: item.originalLocale ?? '—' })}
            </th>
            <th className="py-2 font-medium">{fill(T.translation, { locale: item.locale ?? '—' })}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {keys.map((k) => (
            <tr key={k} className="align-top">
              <td className="text-muted-foreground py-2 pr-3 font-mono text-xs">{k}</td>
              <td className="py-2 pr-3">
                <Value value={item.original?.[k]} empty={empty} />
              </td>
              <td className="py-2">
                <Value value={item.content[k]} empty={empty} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {typeof item.content.note === 'string' ? (
        <p className="text-muted-foreground mt-2 text-xs">note: {item.content.note}</p>
      ) : null}
    </div>
  );
}

function Confirm({
  title,
  description,
  trigger,
  onConfirm,
  confirmLabel,
}: {
  title: string;
  description: string;
  trigger: React.ReactElement;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.review.actions.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SuggestForm({ item, onDone }: { item: Detail; onDone: () => void }) {
  const { t } = useI18n();
  const T = t.review;
  const { send, pending } = useDecide(item.id);
  const editable = Object.keys(item.content).filter((k) => !LOCKED_FIELDS.has(k));
  const [comment, setComment] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((k) => [k, fieldText(item.content[k])])),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!comment.trim()) return setError(T.errors.comment_required);
    const fields: Record<string, unknown> = {};
    for (const k of editable) {
      try {
        const next = parseProposedField(item.content[k], texts[k] ?? '');
        if (next !== undefined) fields[k] = next;
      } catch {
        return setError(
          fill(typeof item.content[k] === 'number' ? T.errors.invalidNumber : T.errors.invalidJson, {
            field: k,
          }),
        );
      }
    }
    setError(null);
    const ok = await send('suggest', { comment, fields: Object.keys(fields).length ? fields : null });
    if (ok) onDone();
  };

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="review-comment">{T.actions.comment}</FieldLabel>
        <Textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={T.actions.commentPlaceholder}
          maxLength={2000}
          rows={3}
        />
      </Field>
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="outline" size="sm" className="w-fit" />}>
          <FilePenLine />
          {T.actions.proposeFields}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 flex flex-col gap-3">
          <FieldDescription>{T.actions.proposeHint}</FieldDescription>
          {editable.map((k) => (
            <Field key={k}>
              <FieldLabel htmlFor={`review-field-${k}`} className="font-mono text-xs">
                {k}
              </FieldLabel>
              <Textarea
                id={`review-field-${k}`}
                value={texts[k] ?? ''}
                onChange={(e) => setTexts((prev) => ({ ...prev, [k]: e.target.value }))}
                rows={Math.min(10, Math.max(1, (texts[k] ?? '').split('\n').length))}
                className="font-mono text-xs"
              />
            </Field>
          ))}
        </CollapsibleContent>
      </Collapsible>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? <Spinner /> : null}
          {T.actions.send}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          {T.actions.cancel}
        </Button>
      </div>
    </div>
  );
}

/** Se o item é servido hoje com o piso que a API relatou, e em cada piso que o cliente pode pedir. */
function ServingCard({ item, serving, timeZone }: { item: Detail; serving: ServingFloor; timeZone: string }) {
  const { t } = useI18n();
  const T = t.review.serving;
  const f = useFormatters(timeZone);
  const floors = floorsFrom(serving.floor);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{T.title}</CardTitle>
        <CardDescription>
          {serving.floor ? (
            <>
              {fill(T.floor, { floor: serving.floor })}
              {serving.reportedAt
                ? ` · ${fill(T.reportedAt, { when: f.relative(serving.reportedAt) })}`
                : null}
            </>
          ) : (
            T.unknownFloor
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {serving.floor ? (
          servedAt(item.state, serving.floor) ? (
            <Badge variant="success-light" size="lg" className="w-fit">
              <Check />
              {T.served}
            </Badge>
          ) : (
            <Badge variant="destructive-light" size="lg" className="w-fit">
              <X />
              {T.notServed}
            </Badge>
          )
        ) : null}
        <div>
          <p className="text-muted-foreground mb-1.5 text-xs">{T.byFloor}</p>
          <ul className="flex flex-wrap gap-1.5">
            {REVIEW_STATUSES.map((floor) => {
              const served = servedAt(item.state, floor);
              return (
                <li key={floor}>
                  <Badge
                    variant={served ? 'success-outline' : 'outline'}
                    className={floors.includes(floor) ? '' : 'opacity-50'}
                  >
                    <span className="font-mono">{floor}</span>
                    {served ? T.yes : T.no}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-muted-foreground text-xs">{fill(T.hint, { floors: floors.join(', ') })}</p>
      </CardContent>
    </Card>
  );
}

interface Props {
  item: Detail;
  preview: ReviewPreview;
  serving: ServingFloor;
  timeZone: string;
}

export function ReviewDetail({ item, preview, serving, timeZone }: Props) {
  const { t } = useI18n();
  const T = t.review;
  const f = useFormatters(timeZone);
  const { send, pending } = useDecide(item.id);
  const [suggesting, setSuggesting] = useState(false);
  const empty = T.detail.empty;
  const stateLabel = (s: string | null) => (s ? ((T.states as Record<string, string>)[s] ?? s) : '—');

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{T.kinds[item.kind]}</Badge>
            <Badge variant={STATE_BADGE[item.state]}>{T.states[item.state]}</Badge>
            {item.stale ? <Badge variant="destructive-outline">{T.table.stale}</Badge> : null}
          </div>
          <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              {T.detail.key}: <span className="font-mono">{item.key}</span>
            </span>
            <span>
              {T.table.sport}: {sportLabel(t, item.sport)}
            </span>
            {item.market ? (
              <span>
                {T.table.market}: {marketLabel(t, item.market)}
              </span>
            ) : null}
            {item.locale ? (
              <span>
                {T.table.locale}: <span className="font-mono">{item.locale}</span>
              </span>
            ) : null}
            <span>
              {T.detail.file}: <span className="font-mono">{item.sourceFile}</span>
            </span>
            <span>
              {T.detail.yamlStatus}: <span className="font-mono">{item.yamlStatus}</span>
            </span>
          </CardDescription>
          {item.stale ? (
            <p className="text-muted-foreground text-xs">
              {fill(T.table.staleHint, { who: item.decidedBy ?? '—' })}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Confirm
            title={T.actions.confirmApprove}
            description={T.actions.confirmApproveDescription}
            confirmLabel={T.actions.approve}
            onConfirm={() => void send('approve')}
            trigger={
              <Button disabled={pending || item.state === 'approved'}>
                {pending ? <Spinner /> : <Check />}
                {T.actions.approve}
              </Button>
            }
          />
          <Confirm
            title={T.actions.confirmDraft}
            description={T.actions.confirmDraftDescription}
            confirmLabel={T.actions.draft}
            onConfirm={() => void send('draft')}
            trigger={
              <Button variant="outline" disabled={pending || item.state === 'draft'}>
                <Undo2 />
                {T.actions.draft}
              </Button>
            }
          />
          <Button variant="outline" onClick={() => setSuggesting((v) => !v)} disabled={pending}>
            <FilePenLine />
            {T.actions.suggest}
          </Button>
        </CardContent>
      </Card>

      {suggesting ? (
        <Card>
          <CardHeader>
            <CardTitle>{T.actions.suggest}</CardTitle>
          </CardHeader>
          <CardContent>
            <SuggestForm item={item} onDone={() => setSuggesting(false)} />
          </CardContent>
        </Card>
      ) : null}

      {item.suggestion ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>{T.detail.openSuggestion}</CardTitle>
            {item.decidedBy && item.decidedAt ? (
              <CardDescription>
                {fill(T.detail.decidedBy, { who: item.decidedBy, when: f.dayTime(item.decidedAt) })}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="whitespace-pre-wrap">{item.suggestion.comment}</p>
            {item.suggestion.fields ? (
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium">{T.detail.proposedEdit}</p>
                <Fields content={item.suggestion.fields} empty={empty} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{T.detail.content}</CardTitle>
          </CardHeader>
          <CardContent>
            {item.kind === 'translation' ? (
              <SideBySide item={item} empty={empty} />
            ) : (
              <Fields content={item.content} empty={empty} />
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <ServingCard item={item} serving={serving} timeZone={timeZone} />
          <Card>
            <CardHeader>
              <CardTitle>{T.detail.preview}</CardTitle>
              <CardDescription>{fill(T.detail.previewHint, { endpoint: preview.endpoint })}</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 font-mono text-xs break-words whitespace-pre-wrap">
                {JSON.stringify(preview.body, null, 2)}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{T.detail.history}</CardTitle>
            </CardHeader>
            <CardContent>
              {item.log.length ? (
                <ol className="flex flex-col gap-3 text-sm">
                  {item.log.map((l) => (
                    <li key={l.id} className="border-l-2 pl-3">
                      <p>
                        <span className="font-medium">{l.actor}</span> {T.log[l.action]}{' '}
                        <span className="text-muted-foreground text-xs">
                          (
                          {fill(T.log.transition, {
                            from: stateLabel(l.fromStatus),
                            to: stateLabel(l.toStatus),
                          })}
                          )
                        </span>
                      </p>
                      <p className="text-muted-foreground text-xs">{f.dayTime(l.createdAt)}</p>
                      {l.comment ? <p className="mt-1 whitespace-pre-wrap">{l.comment}</p> : null}
                      {l.proposed ? (
                        <div className="mt-1">
                          <p className="text-muted-foreground text-xs font-medium">{T.detail.proposedEdit}</p>
                          <Fields content={l.proposed} empty={empty} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">{T.detail.noHistory}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
