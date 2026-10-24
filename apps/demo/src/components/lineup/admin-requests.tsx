'use client';

import { Check, CheckCheck, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { resolveLineupRequest } from '@/app/[locale]/(app)/ajustes/grades/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import {
  NOTE_MAX,
  PROPOSABLE_FIELDS,
  REQUEST_STATUSES,
  type ItemView,
  type RequestStatus,
} from '@/lib/lineup/types';
import type { QueueRequest } from '@/lib/lineup/server';

import { REQUEST_BADGE, RequestBadge, SourceLine, StatusBadge, useFieldText } from './parts';

/** Pedido de inclusão de canal ou streaming num plano: o vínculo ainda não existe na grade. */
const isAdding = (r: QueueRequest) =>
  !r.current &&
  (r.targetType === 'plan_channel' || r.targetType === 'plan_service') &&
  r.platform !== null &&
  r.proposed?.removed !== true;

const ALL = 'todos';

function StatusChips({
  active,
  counts,
}: {
  active: RequestStatus | null;
  counts: Record<RequestStatus, number>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const total = REQUEST_STATUSES.reduce((n, s) => n + counts[s], 0);
  const chip = (status: RequestStatus | null, label: string, count: number) => (
    <button
      key={status ?? ALL}
      type="button"
      aria-pressed={active === status}
      onClick={() => startTransition(() => router.replace(`${pathname}?aba=pedidos&status=${status ?? ALL}`))}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
        active === status
          ? 'border-primary bg-primary/5 text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {status ? (
        <Badge variant={REQUEST_BADGE[status]} size="sm" radius="full" className="size-2 min-w-2 p-0" />
      ) : null}
      {label}
      <span className="text-foreground font-medium tabular-nums">{count}</span>
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" role="group">
      {REQUEST_STATUSES.map((s) => chip(s, t.lineup.requestStatuses[s], counts[s]))}
      {chip(null, t.lineup.admin.requests.all, total)}
      {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
    </div>
  );
}

function Compare({ request }: { request: QueueRequest }) {
  const { t } = useI18n();
  const R = t.lineup.admin.requests;
  const text = useFieldText();
  if (!request.proposed) return <p className="text-muted-foreground text-sm">{R.noProposed}</p>;
  const fields = [...(PROPOSABLE_FIELDS[request.targetType] as readonly string[]), 'removed'];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{R.field}</TableHead>
            <TableHead>{R.current}</TableHead>
            <TableHead>{R.proposed}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields
            .filter((field) => request.proposed?.[field] !== undefined)
            .map((field) => (
              <TableRow key={field}>
                <TableCell className="text-muted-foreground">{text.label(field)}</TableCell>
                <TableCell className="line-through decoration-1 opacity-70">
                  {field === 'removed'
                    ? '—'
                    : text.value(field, request.current?.fields[field as keyof ItemView['fields']])}
                </TableCell>
                <TableCell className="font-medium">{text.value(field, request.proposed?.[field])}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Resolve({ request }: { request: QueueRequest }) {
  const router = useRouter();
  const { t } = useI18n();
  const R = t.lineup.admin.requests;
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = (status: 'accepted' | 'rejected', apply: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await resolveLineupRequest(request.id, { status, note, apply });
      if (!res.ok) return void setError(res.error ?? t.lineup.errors.generic);
      toast.success(status === 'accepted' ? R.accepted : R.rejected);
      router.refresh();
    });
  };
  const canApply = Boolean(request.proposed && (request.current || isAdding(request)));
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor={`note-${request.id}`}>{R.note}</FieldLabel>
        <Textarea
          id={`note-${request.id}`}
          rows={2}
          maxLength={NOTE_MAX}
          placeholder={R.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {canApply ? <FieldDescription>{R.applyHint}</FieldDescription> : null}
      </Field>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canApply ? (
          <Button size="sm" disabled={pending} onClick={() => send('accepted', true)}>
            <CheckCheck />
            {R.acceptApply}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={canApply ? 'outline' : 'default'}
          disabled={pending}
          onClick={() => send('accepted', false)}
        >
          <Check />
          {R.acceptOnly}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !note.trim()}
          onClick={() => send('rejected', false)}
        >
          <X />
          {R.reject}
        </Button>
        {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
      </div>
    </div>
  );
}

/** Fila dos pedidos de revisão das operadoras: o pedido, o item atual ao lado do proposto e a resolução. */
export function LineupRequests({
  requests,
  counts,
  status,
  timeZone,
}: {
  requests: QueueRequest[];
  counts: Record<RequestStatus, number>;
  status: RequestStatus | null;
  timeZone: string;
}) {
  const { t } = useI18n();
  const R = t.lineup.admin.requests;
  const f = useFormatters(timeZone);
  return (
    <div className="flex flex-col gap-3">
      <StatusChips active={status} counts={counts} />
      {requests.length ? (
        requests.map((r) => (
          <Card key={r.id} size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {fill(R.target, {
                  type: t.lineup.types[r.targetType],
                  name: r.current?.name ?? r.targetName ?? '—',
                })}
                {r.platform ? (
                  <span className="text-muted-foreground text-sm font-normal">
                    {fill(R.onPlatform, { platform: r.platform.name })}
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-2 text-xs">
                <span>{fill(R.from, { tenant: r.tenant.name, email: r.userEmail ?? '—' })}</span>
                <span aria-hidden>·</span>
                <span>{fill(R.sentAt, { when: f.relative(r.createdAt) })}</span>
              </CardDescription>
              <CardAction className="flex items-center gap-1">
                {r.current ? <StatusBadge status={r.current.status} /> : null}
                <RequestBadge status={r.status} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs font-medium">{R.message}</span>
                <p className="text-sm whitespace-pre-line">{r.message}</p>
              </div>
              {r.current || isAdding(r) ? (
                <>
                  {r.current ? (
                    <SourceLine sources={r.current.sources} timeZone={timeZone} />
                  ) : (
                    <Alert variant="info">
                      <AlertDescription>{R.adding}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-xs font-medium">{R.compare}</span>
                    <Compare request={r} />
                  </div>
                </>
              ) : (
                <Alert variant="warning">
                  <AlertDescription>{R.removed}</AlertDescription>
                </Alert>
              )}
              {r.status === 'open' ? (
                <Resolve request={r} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {fill(R.resolved, {
                    status: t.lineup.requestStatuses[r.status],
                    who: r.resolvedBy ?? '—',
                    when: r.resolvedAt ? f.relative(r.resolvedAt) : '—',
                  })}
                  {r.resolutionNote ? ` · ${r.resolutionNote}` : ''}
                </p>
              )}
            </CardContent>
          </Card>
        ))
      ) : (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">{R.empty}</p>
      )}
    </div>
  );
}
