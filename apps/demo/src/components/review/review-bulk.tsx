'use client';

import { Check, FilePenLine, Undo2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import type { ReviewAction } from '@/lib/review/types';

interface Props {
  ids: string[];
  onDone: () => void;
}

/** Barra das ações em massa sobre os itens marcados na lista (aprovar, voltar para rascunho, pedir revisão). */
export function ReviewBulkBar({ ids, onDone }: Props) {
  const { t, locale } = useI18n();
  const T = t.review;
  const B = T.bulk;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  const send = (action: ReviewAction, extra: { comment?: string } = {}) =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        try {
          const res = await fetch('/api/ajustes/revisao/lote', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids, action, ...extra }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            code?: string;
            data?: { changed: number; unchanged: number; failed: unknown[] };
          };
          if (!res.ok || !json.data) {
            const code = json.code as keyof typeof T.errors | undefined;
            toast.error(code && code in T.errors ? T.errors[code] : T.errors.failed);
            resolve(false);
            return;
          }
          const { changed, unchanged, failed } = json.data;
          const text = fill(B.done, { changed, unchanged, failed: failed.length });
          if (failed.length) toast.warning(text);
          else toast.success(text);
          onDone();
          router.refresh();
          resolve(true);
        } catch {
          toast.error(T.errors.failed);
          resolve(false);
        }
      }),
    );

  const confirm = (action: 'approve' | 'draft', title: string, label: string, icon: React.ReactNode) => (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant={action === 'approve' ? 'default' : 'outline'} disabled={pending}>
            {pending ? <Spinner /> : icon}
            {label}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {action === 'approve' ? T.actions.confirmApproveDescription : T.actions.confirmDraftDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{T.actions.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void send(action)}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="bg-muted/60 sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 backdrop-blur">
      <span className="mr-auto text-sm font-medium">{plural(locale, ids.length, B.selected)}</span>
      {confirm('approve', B.confirmApprove, B.approve, <Check />)}
      {confirm('draft', B.confirmDraft, B.draft, <Undo2 />)}
      <Dialog open={suggesting} onOpenChange={setSuggesting}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" disabled={pending}>
              <FilePenLine />
              {B.suggest}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{B.suggestTitle}</DialogTitle>
            <DialogDescription>{B.suggestDescription}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={T.actions.commentPlaceholder}
            aria-label={T.actions.comment}
            maxLength={2000}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggesting(false)}>
              {T.actions.cancel}
            </Button>
            <Button
              disabled={pending || !comment.trim()}
              onClick={() =>
                void send('suggest', { comment }).then((ok) => {
                  if (!ok) return;
                  setSuggesting(false);
                  setComment('');
                })
              }
            >
              {pending ? <Spinner /> : null}
              {T.actions.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
        <X />
        {B.clear}
      </Button>
    </div>
  );
}
