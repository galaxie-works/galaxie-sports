'use client';

import {
  DOMAIN_LISTS,
  LIST_LOCALES,
  MODERATION_LISTS,
  SCREEN_KINDS,
  TERM_CATEGORIES,
  type ListLocale,
  type ModerationListName,
  type ScreenKind,
} from '@galaxie/engage';
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  saveModerationListAction,
  testScreenAction,
  type ScreenTestResult,
} from '@/app/[locale]/(app)/ajustes/moderacao/actions';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface ModerationListView {
  list: ModerationListName;
  locale: ListLocale;
  terms: string[];
  version: number;
  updatedAt: string;
}

export interface ModerationLogView {
  list: ModerationListName;
  locale: ListLocale;
  version: number;
  count: number;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

const SAMPLE = 4;

/** Listas que podem existir: categoria de termo por idioma; domínios e exceções só em `all`. */
const ALL_LISTS: Array<{ list: ModerationListName; locale: ListLocale }> = MODERATION_LISTS.flatMap((list) =>
  (TERM_CATEGORIES as readonly string[]).includes(list)
    ? LIST_LOCALES.map((locale) => ({ list, locale }))
    : [{ list, locale: 'all' as ListLocale }],
);
const TEST_LOCALES = ['pt-BR', 'es-AR', 'en'] as const;

/**
 * Ajustes → Conformidade → Moderação (#969): as listas base do filtro (tabela e edição com versão e motivo), o
 * histórico e o teste de um texto. O filtro roda no servidor, em `@galaxie/engage`.
 */
export function ModerationListsPanel({
  lists,
  log,
  timeZone,
}: {
  lists: ModerationListView[];
  log: ModerationLogView[];
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.moderationLists;
  const f = useFormatters(timeZone);
  const [editing, setEditing] = useState<ModerationListView | null>(null);
  const [adding, setAdding] = useState('');
  const missing = ALL_LISTS.filter((a) => !lists.some((l) => l.list === a.list && l.locale === a.locale));

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.lists.title}</FrameTitle>
              <FrameDescription>{T.lists.description}</FrameDescription>
            </div>
            {missing.length ? (
              <div className="flex items-center gap-2">
                <Select value={adding} onValueChange={(v) => setAdding(v ?? '')}>
                  <SelectTrigger className="w-56" aria-label={T.lists.add}>
                    <SelectValue placeholder={T.lists.add} />
                  </SelectTrigger>
                  <SelectContent>
                    {missing.map((m) => (
                      <SelectItem key={`${m.list}:${m.locale}`} value={`${m.list}:${m.locale}`}>
                        {T.names[m.list]} · {T.locales[m.locale]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!adding}
                  onClick={() => {
                    const [list, locale] = adding.split(':') as [ModerationListName, ListLocale];
                    setEditing({ list, locale, terms: [], version: 0, updatedAt: '' });
                    setAdding('');
                  }}
                >
                  <Plus />
                  {T.lists.create}
                </Button>
              </div>
            ) : null}
          </FrameHeader>
          {lists.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.lists.list}</TableHead>
                  <TableHead>{T.lists.locale}</TableHead>
                  <TableHead>{T.lists.count}</TableHead>
                  <TableHead>{T.lists.sample}</TableHead>
                  <TableHead>{T.lists.version}</TableHead>
                  <TableHead className="sr-only">{T.lists.edit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lists.map((l) => (
                  <TableRow key={`${l.list}:${l.locale}`}>
                    <TableCell className="font-medium">{T.names[l.list]}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{T.locales[l.locale]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{l.terms.length}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate font-mono text-xs">
                      {l.terms.slice(0, SAMPLE).join(', ')}
                      {l.terms.length > SAMPLE ? '…' : ''}
                    </TableCell>
                    <TableCell className="text-xs">
                      v{l.version} · {f.relative(l.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(l)}
                        aria-label={T.lists.edit}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">{T.lists.empty}</p>
          )}
        </FramePanel>
      </Frame>

      <div className="grid gap-4 lg:grid-cols-2">
        <ScreenTestCard />
        <Frame>
          <FramePanel className="p-0">
            <FrameHeader className="p-4">
              <FrameTitle>{T.log.title}</FrameTitle>
              <FrameDescription>{T.log.description}</FrameDescription>
            </FrameHeader>
            {log.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.lists.list}</TableHead>
                    <TableHead>{T.log.when}</TableHead>
                    <TableHead>{T.log.who}</TableHead>
                    <TableHead>{T.log.reason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.map((l) => (
                    <TableRow key={`${l.list}:${l.locale}:${l.version}`}>
                      <TableCell className="text-xs">
                        {T.names[l.list]} · {T.locales[l.locale]} v{l.version}
                      </TableCell>
                      <TableCell className="text-xs">{f.relative(l.changedAt)}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{l.changedBy}</TableCell>
                      <TableCell className="text-xs">{l.reason ?? T.log.noReason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground p-4 text-sm">{T.log.empty}</p>
            )}
          </FramePanel>
        </Frame>
      </div>

      {editing ? (
        <ListDialog
          key={`${editing.list}:${editing.locale}:${editing.version}`}
          current={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ListDialog({ current, onClose }: { current: ModerationListView; onClose: () => void }) {
  const { t } = useI18n();
  const T = t.moderationLists;
  const F = T.form;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(current.terms.join('\n'));
  const [reason, setReason] = useState('');
  const isDomain = (DOMAIN_LISTS as readonly string[]).includes(current.list);
  const name = T.names[current.list];

  const submit = () =>
    start(async () => {
      const r = await saveModerationListAction({
        list: current.list,
        locale: current.locale,
        terms: text.split('\n'),
        // versão 0 = lista nova (ainda não gravada)
        expectedVersion: current.version || null,
        reason,
      });
      if (!r.ok) return void toast.error(r.error ?? T.errors.generic);
      toast.success(fill(F.saved, { list: name, version: r.version ?? '', count: r.count ?? '' }));
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{fill(F.title, { list: name, locale: T.locales[current.locale] })}</DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="moderation-terms">{F.terms}</FieldLabel>
            <Textarea
              id="moderation-terms"
              className="min-h-64 font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <FieldDescription>{isDomain ? F.domainsHint : F.termsHint}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="moderation-reason">{F.reason}</FieldLabel>
            <Input
              id="moderation-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldDescription>{F.reasonHint}</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {F.cancel}
          </Button>
          <Button onClick={submit} disabled={pending || !reason.trim()}>
            {pending ? <Spinner /> : null}
            {F.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScreenTestCard() {
  const { t } = useI18n();
  const T = t.moderationLists;
  const X = T.test;
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ScreenKind>('chat_message');
  const [locale, setLocale] = useState<(typeof TEST_LOCALES)[number]>('pt-BR');
  const [result, setResult] = useState<ScreenTestResult | null>(null);

  const run = () =>
    start(async () => {
      const r = await testScreenAction({ text, kind, locale });
      if (!r) toast.error(T.errors.generic);
      setResult(r);
    });

  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4 p-4">
        <FrameHeader className="p-0">
          <FrameTitle>{X.title}</FrameTitle>
          <FrameDescription>{X.description}</FrameDescription>
        </FrameHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="moderation-test-text">{X.text}</FieldLabel>
            <Textarea
              id="moderation-test-text"
              value={text}
              maxLength={5000}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="moderation-test-kind">{X.kind}</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as ScreenKind)}>
                <SelectTrigger id="moderation-test-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCREEN_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {T.kinds[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="moderation-test-locale">{X.language}</FieldLabel>
              <Select value={locale} onValueChange={(v) => setLocale(v as (typeof TEST_LOCALES)[number])}>
                <SelectTrigger id="moderation-test-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEST_LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
        <div>
          <Button onClick={run} disabled={pending || !text.trim()}>
            {pending ? <Spinner /> : null}
            {X.run}
          </Button>
        </div>
        {result ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" aria-live="polite">
            <dt className="text-muted-foreground">{X.result}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  result.action === 'allow'
                    ? 'success-light'
                    : result.action === 'block'
                      ? 'warning-light'
                      : 'destructive-light'
                }
              >
                {T.actions[result.action]}
              </Badge>
              {result.suspect ? <Badge variant="secondary">{X.suspect}</Badge> : null}
              {result.evasion ? <Badge variant="secondary">{X.evasion}</Badge> : null}
            </dd>
            <dt className="text-muted-foreground">{X.reasons}</dt>
            <dd>{result.reasons.length ? result.reasons.map((r) => T.reasons[r]).join(', ') : X.none}</dd>
            <dt className="text-muted-foreground">{X.notice}</dt>
            <dd>{result.notice ?? X.none}</dd>
          </dl>
        ) : null}
      </FramePanel>
    </Frame>
  );
}
