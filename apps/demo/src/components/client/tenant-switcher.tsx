'use client';

import { Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { selectTenant } from '@/app/[locale]/(app)/client/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { STAFF_REASON_MAX, STAFF_REASON_MIN } from '@/lib/client/staff-reason';
import type { TenantOption } from '@/lib/client/tenants';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * Janela do motivo da equipe Galaxie (PL17): ao entrar num tenant de cliente, o ticket ou o pedido do cliente, que
 * fica registrado em toda escrita. Serve também para trocar o motivo no tenant em foco.
 */
export function StaffReasonDialog({
  open,
  tenant,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  tenant: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const s = t.client.staff;
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valid = reason.trim().length >= STAFF_REASON_MIN;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setReason('');
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tenant || !valid) return;
            startTransition(async () => {
              const res = await selectTenant(tenant.id, reason);
              if (!res.ok) return void setError(res.error ?? t.client.errors.generic);
              toast.success(t.client.tenant.switched);
              onOpenChange(false);
              setReason('');
              onDone?.();
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{tenant ? fill(s.reasonTitle, { tenant: tenant.name }) : s.reasonTitleShort}</DialogTitle>
            <DialogDescription>{s.reasonDescription}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${id}-reason`}>{s.reason}</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={STAFF_REASON_MAX}
              autoFocus
            />
            <FieldDescription>{s.reasonHint}</FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {t.client.members.cancel}
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {s.reasonConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Qual marca acompanhar: a equipe Galaxie escolhe qualquer tenant (e informa o motivo quando o tenant é de um
 * cliente, `askReason`); o cliente com cargo em mais de uma marca (organização, PL16) escolhe entre as dele. A escolha
 * fica no cookie `galaxie-tenant`, conferido a cada leitura.
 */
export function TenantSwitcher({
  tenants,
  value,
  askReason = false,
}: {
  tenants: TenantOption[];
  value: string | null;
  askReason?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<TenantOption | null>(null);
  const items = tenants.map((x) => ({ value: x.id, label: x.name }));
  return (
    <div className="flex items-center gap-2">
      <Building2 className="text-muted-foreground size-4" aria-hidden />
      <Select
        items={items}
        value={value}
        disabled={pending}
        onValueChange={(v) => {
          if (!v) return;
          const target = tenants.find((x) => x.id === String(v));
          if (askReason && target && !target.isGalaxie) return void setAsking(target);
          startTransition(async () => {
            const res = await selectTenant(String(v));
            if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
            toast.success(t.client.tenant.switched);
            router.refresh();
          });
        }}
      >
        <SelectTrigger className="w-56" aria-label={t.client.tenant.viewing}>
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
      {askReason ? (
        <StaffReasonDialog open={asking !== null} tenant={asking} onOpenChange={(o) => !o && setAsking(null)} />
      ) : null}
    </div>
  );
}
