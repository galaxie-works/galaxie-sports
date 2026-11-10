'use client';

import { useId, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

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
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n/client';

/**
 * Janela das ações da equipe nas carteiras: os campos da ação (quando há) e o motivo obrigatório, que fica no
 * registro. `onConfirm` devolve o erro para mostrar ou fecha a janela.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  children,
  canConfirm = true,
  onConfirm,
}: {
  trigger: React.ReactElement;
  title: string;
  description?: string;
  /** Campos da ação, acima do motivo. */
  children?: ReactNode;
  canConfirm?: boolean;
  onConfirm: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t } = useI18n();
  const T = t.cosmosStaff.actions;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valid = reason.trim().length >= 5;

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const r = await onConfirm(reason);
      if (!r.ok) {
        setError(r.error ?? T.errors.generic);
        return;
      }
      toast.success(T.done);
      setReason('');
      setOpen(false);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {children}
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${id}-reason`}>{T.reason}</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <FieldDescription>{T.reasonHint}</FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {T.cancel}
          </Button>
          <Button disabled={pending || !valid || !canConfirm} onClick={confirm}>
            {T.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
