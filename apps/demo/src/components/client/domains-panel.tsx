'use client';

import { Globe, Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  addDomainAction,
  removeDomainAction,
  verifyDomainAction,
} from '@/app/[locale]/(app)/client/domains/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { SafetyNote, SettingsSection } from '@/components/settings';
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { txtRecordName, type DomainRow } from '@/lib/client/domains';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { CodeSnippet } from './code-snippet';

function AddDomainDialog() {
  const router = useRouter();
  const { t } = useI18n();
  const d = t.client.domains;
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setHost('');
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus aria-hidden />
        {d.add}
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await addDomainAction({ host });
              if (!res.ok) return void setError(res.error ?? t.client.errors.generic);
              toast.success(d.added);
              setOpen(false);
              setHost('');
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{d.addTitle}</DialogTitle>
            <DialogDescription>{d.addDescription}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="domain-host">{d.host}</FieldLabel>
            <Input
              id="domain-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />
            <FieldDescription>{d.hostHint}</FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {d.cancel}
            </Button>
            <Button type="submit" disabled={pending || !host.trim()}>
              {pending ? <Spinner /> : null}
              {d.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VerifyButton({ row }: { row: DomainRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const d = t.client.domains;
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || row.checking}
      onClick={() =>
        startTransition(async () => {
          const res = await verifyDomainAction({ id: row.id });
          if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
          toast.success(res.queued ? d.alreadyQueued : d.queued);
          router.refresh();
        })
      }
    >
      {pending || row.checking ? <Spinner /> : <RefreshCw aria-hidden />}
      {row.checking ? d.checking : d.verify}
    </Button>
  );
}

function RemoveButton({ row }: { row: DomainRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const d = t.client.domains;
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        {pending ? <Spinner /> : null}
        {d.remove}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(d.removeTitle, { host: row.host })}</AlertDialogTitle>
          <AlertDialogDescription>{d.removeBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{d.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const res = await removeDomainAction({ id: row.id });
                if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
                toast.success(d.removed);
                router.refresh();
              })
            }
          >
            {d.remove}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Cliente → Integrações → Domínios: a lista, o TXT a criar para cada host e os botões de conferir e remover. */
export function DomainsPanel({
  domains,
  manage,
  timeZone,
}: {
  domains: DomainRow[];
  manage: boolean;
  timeZone: string;
}) {
  const { t } = useI18n();
  const d = t.client.domains;
  const fmt = useFormatters(timeZone);
  return (
    <SettingsSection title={d.title} description={d.description} action={manage ? <AddDomainDialog /> : null}>
      {!manage ? <SafetyNote>{d.readOnly}</SafetyNote> : null}
      <Frame>
        <FramePanel className="p-0">
          {domains.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{d.host}</TableHead>
                  <TableHead>{d.status}</TableHead>
                  <TableHead>{d.txt}</TableHead>
                  <TableHead className="text-right">{d.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-medium">
                          <Globe className="text-muted-foreground size-3.5" aria-hidden />
                          {row.host}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">{fmt.date(row.createdAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        {row.verifiedAt ? (
                          <Badge variant="success-light" size="sm" className="w-fit">
                            {d.verified}
                          </Badge>
                        ) : (
                          <Badge variant="warning-light" size="sm" className="w-fit">
                            {d.unverified}
                          </Badge>
                        )}
                        {row.lastCheckedAt ? (
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {fill(d.lastChecked, { when: fmt.dateTime(row.lastCheckedAt) })}
                          </span>
                        ) : null}
                        {row.lastError && !row.verifiedAt ? (
                          <span className="text-destructive text-xs">{row.lastError}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex max-w-md flex-col gap-1 text-xs">
                        <span className="text-muted-foreground">{d.txtName}</span>
                        <CodeSnippet code={txtRecordName(row.host)} />
                        <span className="text-muted-foreground">{d.txtValue}</span>
                        <CodeSnippet code={row.txtToken} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {manage ? (
                        <div className="flex justify-end gap-2">
                          {!row.verifiedAt ? <VerifyButton row={row} /> : null}
                          <RemoveButton row={row} />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">{d.empty}</p>
          )}
        </FramePanel>
      </Frame>
      <SafetyNote>{d.note}</SafetyNote>
    </SettingsSection>
  );
}
