'use client';

import { KeyRound, Plus, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createKey, revokeKey } from '@/app/[locale]/(app)/cliente/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { PUBLISHABLE_KEY_ENV } from '@/lib/builder/config';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { CodeSnippet } from './code-snippet';

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  allowedOrigins: string[];
  widgetId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const ANY = '__any__';

function CreateKeyDialog({ widgets }: { widgets: { id: string; name: string }[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const k = t.client.keys;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [widgetId, setWidgetId] = useState(ANY);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const items = [{ value: ANY, label: k.widgetAny }, ...widgets.map((w) => ({ value: w.id, label: w.name }))];

  function reset() {
    setName('');
    setOrigins('');
    setWidgetId(ANY);
    setError(null);
    setKey(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createKey({ name, origins, widgetId: widgetId === ANY ? null : widgetId });
      if (!res.ok || !res.key) return void setError(res.error ?? t.client.errors.generic);
      setKey(res.key);
      router.refresh();
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
      <DialogTrigger render={<Button />}>
        <Plus />
        {k.create}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{key ? k.createdTitle : k.createTitle}</DialogTitle>
          <DialogDescription>{k.createDescription}</DialogDescription>
        </DialogHeader>
        {key ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning">
              <ShieldAlert />
              <AlertDescription>{k.onceWarning}</AlertDescription>
            </Alert>
            <CodeSnippet code={key} />
            <p className="text-muted-foreground text-sm">{fill(k.envHint, { env: PUBLISHABLE_KEY_ENV })}</p>
            <CodeSnippet code={`${PUBLISHABLE_KEY_ENV}=${key}`} />
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                {k.done}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="key-name">{k.name}</FieldLabel>
                <Input
                  id="key-name"
                  required
                  autoFocus
                  maxLength={80}
                  placeholder={k.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="key-origins">{k.origins}</FieldLabel>
                <Textarea
                  id="key-origins"
                  required
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder={k.originsPlaceholder}
                  value={origins}
                  onChange={(e) => setOrigins(e.target.value)}
                />
                <FieldDescription>{k.originsHint}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="key-widget">{k.widget}</FieldLabel>
                <Select items={items} value={widgetId} onValueChange={(v) => setWidgetId(String(v ?? ANY))}>
                  <SelectTrigger id="key-widget" className="w-full">
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
                <FieldDescription>{k.widgetHint}</FieldDescription>
              </Field>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : <KeyRound />}
                {k.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeButton({ row }: { row: KeyRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const k = t.client.keys;
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        {pending ? <Spinner /> : null}
        {k.revoke}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(k.revokeTitle, { name: row.name })}</AlertDialogTitle>
          <AlertDialogDescription>{k.revokeDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{k.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const res = await revokeKey(row.id);
                if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
                toast.success(k.revokedToast);
                router.refresh();
              })
            }
          >
            {k.revoke}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Chaves publicáveis do tenant: criar (a chave aparece uma vez), listar e revogar. */
export function KeysPanel({
  keys,
  widgets,
  timeZone,
}: {
  keys: KeyRow[];
  widgets: { id: string; name: string }[];
  timeZone: string;
}) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const k = t.client.keys;
  const widgetName = (id: string | null) =>
    id ? (widgets.find((w) => w.id === id)?.name ?? id.slice(0, 8)) : k.anyWidget;
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="flex flex-row items-start justify-between gap-4 p-4">
          <div className="flex flex-col gap-1">
            <FrameTitle>{k.title}</FrameTitle>
            <FrameDescription>{k.description}</FrameDescription>
          </div>
          <CreateKeyDialog widgets={widgets} />
        </FrameHeader>
        {keys.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{k.columns.name}</TableHead>
                <TableHead>{k.columns.key}</TableHead>
                <TableHead>{k.columns.origins}</TableHead>
                <TableHead>{k.columns.widget}</TableHead>
                <TableHead>{k.columns.created}</TableHead>
                <TableHead>{k.columns.status}</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((row) => (
                <TableRow key={row.id} className={row.revokedAt ? 'opacity-60' : undefined}>
                  <TableCell className="pl-4 font-medium">{row.name}</TableCell>
                  <TableCell>
                    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{row.prefix}…</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {row.allowedOrigins.map((o) => (
                        <Badge key={o} variant="outline" className="font-mono text-[11px]">
                          {o}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{widgetName(row.widgetId)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{f.date(row.createdAt)}</TableCell>
                  <TableCell>
                    {row.revokedAt ? (
                      <Badge variant="secondary" radius="full">
                        {k.revoked} · {f.date(row.revokedAt)}
                      </Badge>
                    ) : (
                      <Badge variant="success-light" radius="full">
                        {k.active}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {row.revokedAt ? null : <RevokeButton row={row} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground px-4 pb-6 text-sm">{k.empty}</p>
        )}
      </FramePanel>
    </Frame>
  );
}
