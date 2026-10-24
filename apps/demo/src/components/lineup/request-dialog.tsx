'use client';

import { MessageSquareWarning, Plus, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { requestLineupReview } from '@/app/[locale]/(app)/cliente/grade/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import {
  ACCESS,
  FIELD_MAX,
  MESSAGE_MAX,
  PROPOSABLE_FIELDS,
  REMOVABLE_TYPES,
  type ItemView,
  type LibraryEntry,
  type PlanView,
  type ProposableField,
  type TargetType,
} from '@/lib/lineup/types';

const KEEP = '__keep';

/** Envia o pedido; devolve o erro (ou null) para o diálogo mostrar. */
function useSend(onDone: () => void) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = (input: Parameters<typeof requestLineupReview>[0]) => {
    setError(null);
    startTransition(async () => {
      const res = await requestLineupReview(input);
      if (!res.ok) return void setError(res.error ?? t.lineup.errors.generic);
      toast.success(t.lineup.request.sent);
      onDone();
      router.refresh();
    });
  };
  return { error, setError, pending, send };
}

function AccessSelect({
  id,
  value,
  onChange,
  keepLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  keepLabel?: string;
}) {
  const { t } = useI18n();
  const items = [
    ...(keepLabel ? [{ value: KEEP, label: keepLabel }] : []),
    ...ACCESS.map((a) => ({ value: a, label: t.lineup.access[a] })),
  ];
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? KEEP))}>
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

/**
 * "Solicitar revisão" de um item da grade: o que está errado (obrigatório) e, se quiser, a correção por
 * campo ou a saída do item da grade. O pedido vai para a fila da Galaxie e o status aparece em "Meus pedidos".
 */
export function RequestReviewDialog({ item, compact }: { item: ItemView; compact?: boolean }) {
  const { t } = useI18n();
  const T = t.lineup.request;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState(false);
  const fields = PROPOSABLE_FIELDS[item.type] as readonly ProposableField[];
  const removable = REMOVABLE_TYPES.includes(item.type);

  function reset() {
    setMessage('');
    setProposed({});
    setRemoved(false);
    setError(null);
  }
  const { error, setError, pending, send } = useSend(() => {
    setOpen(false);
    reset();
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(proposed).filter(([, v]) => v && v !== KEEP));
    send({
      targetType: item.type,
      targetId: item.id,
      message,
      proposed: removed ? { removed: true } : clean,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button
            size={compact ? 'icon-xs' : 'xs'}
            variant="ghost"
            aria-label={`${T.trigger}: ${item.name}`}
            title={compact ? T.trigger : undefined}
          />
        }
      >
        <MessageSquareWarning />
        {compact ? null : T.trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{fill(T.description, { name: item.name })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="lineup-msg">{T.message}</FieldLabel>
              <Textarea
                id="lineup-msg"
                required
                autoFocus
                rows={3}
                maxLength={MESSAGE_MAX}
                placeholder={T.messagePlaceholder}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
            <FieldSet disabled={removed}>
              <FieldLegend variant="label">{T.proposed}</FieldLegend>
              <FieldDescription>{T.proposedHint}</FieldDescription>
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => {
                  const current = item.fields[field] ?? null;
                  const shown =
                    field === 'access' && current
                      ? t.lineup.access[current as 'included' | 'addon']
                      : current;
                  return (
                    <Field key={field}>
                      <FieldLabel htmlFor={`lineup-${field}`}>{t.lineup.fields[field]}</FieldLabel>
                      {field === 'access' ? (
                        <AccessSelect
                          id={`lineup-${field}`}
                          keepLabel={T.keep}
                          value={proposed[field] ?? KEEP}
                          onChange={(v) => setProposed((p) => ({ ...p, [field]: v }))}
                        />
                      ) : (
                        <Input
                          id={`lineup-${field}`}
                          maxLength={FIELD_MAX}
                          placeholder={current ?? T.empty}
                          value={proposed[field] ?? ''}
                          onChange={(e) => setProposed((p) => ({ ...p, [field]: e.target.value }))}
                        />
                      )}
                      <FieldDescription className="truncate">
                        {fill(T.current, { value: shown ?? T.empty })}
                      </FieldDescription>
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
            {removable ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="lineup-removed"
                  checked={removed}
                  onCheckedChange={(v) => setRemoved(v === true)}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="lineup-removed">{T.remove}</FieldLabel>
                  <FieldDescription>{T.removeHint}</FieldDescription>
                </div>
              </Field>
            ) : null}
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending || !message.trim()}>
              {pending ? <Spinner /> : <Send />}
              {T.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Falta um canal": pedir a inclusão de um canal ou streaming da biblioteca num plano que já existe (o
 * pedido não cria plano). O item escolhido vira um pedido sobre o vínculo `<plano>:<canal>`.
 */
export function RequestAddDialog({ plan, library }: { plan: PlanView; library: LibraryEntry[] }) {
  const { t } = useI18n();
  const T = t.lineup.request;
  const [open, setOpen] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [access, setAccess] = useState<string>('included');
  const [message, setMessage] = useState('');
  const present = new Set([...plan.channels, ...plan.services].map((i) => i.id.slice(i.id.indexOf(':') + 1)));
  const items = library.filter((e) => !present.has(e.id)).map((e) => ({ value: e.id, label: e.name }));

  function reset() {
    setEntryId(null);
    setAccess('included');
    setMessage('');
    setError(null);
  }
  const { error, setError, pending, send } = useSend(() => {
    setOpen(false);
    reset();
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const entry = library.find((x) => x.id === entryId);
    if (!entry) return;
    const type: TargetType = entry.kind === 'streaming' ? 'plan_service' : 'plan_channel';
    send({ targetType: type, targetId: `${plan.id}:${entry.id}`, message, proposed: { access } });
  }

  if (!items.length) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button size="xs" variant="ghost" />}>
        <Plus />
        {T.addTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fill(T.addTitle, { plan: plan.name })}</DialogTitle>
          <DialogDescription>{T.addDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="lineup-add-entry">{T.addEntry}</FieldLabel>
                <Select items={items} value={entryId} onValueChange={(v) => setEntryId(v ? String(v) : null)}>
                  <SelectTrigger id="lineup-add-entry" className="w-full">
                    <SelectValue>
                      {(v: string | null) =>
                        v ? (
                          items.find((i) => i.value === v)?.label
                        ) : (
                          <span className="text-muted-foreground">{T.addPlaceholder}</span>
                        )
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="lineup-add-access">{t.lineup.fields.access}</FieldLabel>
                <AccessSelect id="lineup-add-access" value={access} onChange={setAccess} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="lineup-add-msg">{T.message}</FieldLabel>
              <Textarea
                id="lineup-add-msg"
                required
                rows={3}
                maxLength={MESSAGE_MAX}
                placeholder={T.addMessagePlaceholder}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
          </FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending || !entryId || !message.trim()}>
              {pending ? <Spinner /> : <Send />}
              {T.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
