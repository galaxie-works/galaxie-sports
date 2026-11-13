'use client';

import type { CreditPackageView } from '@galaxie/cosmos';
import { HandCoins } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { ExplainEmpty, SettingsSection } from '@/components/settings';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  cancelCosmosCreditRequest,
  decideCosmosCreditRequest,
  requestCosmosCredits,
} from '@/lib/cosmos/credit-request-actions';
import type { CreditRequestView } from '@/lib/cosmos/credit-request-data';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { PurchaseDialog } from './purchase-dialog';
import { quotaScopeLabel } from './quota-scope';

const REASON_MIN = 5;
const REASON_MAX = 500;

const STATUS_VARIANT = {
  open: 'warning-light',
  approved: 'success-light',
  declined: 'destructive-light',
  canceled: 'secondary',
} as const;

/**
 * Pedido de créditos ao dono (#996). Quem não pode comprar pede com uma justificativa e acompanha a resposta; quem
 * pode (`canManage`) vê os pedidos, aprova (abre a compra ou aumenta a cota de uma sala, #1116) ou recusa com uma nota.
 * O servidor confere o cargo de novo.
 */
export function CreditRequests({
  requests,
  canManage,
  packages,
  scopes = [],
}: {
  requests: CreditRequestView[];
  canManage: boolean;
  packages: CreditPackageView[];
  /** Salas que podem ganhar cota ao aprovar (#1116); vazio = só a compra. */
  scopes?: string[];
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.creditRequests;
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState<CreditRequestView | null>(null);
  const [note, setNote] = useState('');
  const [buying, setBuying] = useState(false);
  const [approving, setApproving] = useState<CreditRequestView | null>(null);
  const [raiseScope, setRaiseScope] = useState('');
  const [raisePercent, setRaisePercent] = useState('');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const open = requests.filter((r) => r.status === 'open');
  const myOpen = open.find((r) => r.mine) ?? null;
  // conta como o servidor e o Postgres (code points): emoji vale 1
  const size = [...reason.trim()].length;
  const reasonOk = size >= REASON_MIN && size <= REASON_MAX;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        toast.error(r.error);
        router.refresh();
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });

  const send = () =>
    run(
      () => requestCosmosCredits(reason),
      T.sent,
      () => {
        setAsking(false);
        setReason('');
      },
    );
  const closeApprove = () => {
    setApproving(null);
    setRaiseScope('');
    setRaisePercent('');
  };
  const approve = () =>
    approving &&
    run(
      () => decideCosmosCreditRequest(approving.id, 'approved'),
      T.approved,
      () => {
        closeApprove();
        setBuying(true);
      },
    );
  const percent = Number(raisePercent.replace(',', '.'));
  const raiseOk = raiseScope !== '' && Number.isFinite(percent) && percent > 0 && percent <= 100;
  const approveRaise = () =>
    approving &&
    raiseOk &&
    run(
      () =>
        decideCosmosCreditRequest(approving.id, 'approved', undefined, {
          scope: raiseScope,
          addPercent: percent,
        }),
      T.quotaRaised,
      closeApprove,
    );
  const decline = () =>
    declining &&
    run(
      () => decideCosmosCreditRequest(declining.id, 'declined', note),
      T.declined,
      () => {
        setDeclining(null);
        setNote('');
      },
    );

  const item = (r: CreditRequestView) => (
    <li key={r.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {fill(T.requestedBy, { who: r.requester ?? T.someone, date: when.format(new Date(r.createdAt)) })}
        </span>
        <Badge variant={STATUS_VARIANT[r.status]}>{T.status[r.status]}</Badge>
      </div>
      <p className="whitespace-pre-line">{r.reason}</p>
      {r.decidedAt && r.status !== 'canceled' ? (
        <p className="text-muted-foreground text-xs">
          {fill(T.decidedBy, { who: r.decider ?? T.someone, date: when.format(new Date(r.decidedAt)) })}
          {r.decisionNote ? ` · ${r.decisionNote}` : ''}
        </p>
      ) : null}
      {r.status === 'open' && canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(r)}>
            {T.decline}
          </Button>
          <Button
            size="sm"
            disabled={pending || (!packages.length && !scopes.length)}
            onClick={() => setApproving(r)}
          >
            {T.approveOpen}
          </Button>
        </div>
      ) : null}
      {r.status === 'open' && r.mine && !canManage ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => cancelCosmosCreditRequest(r.id), T.canceled)}
          >
            {T.cancel}
          </Button>
        </div>
      ) : null}
    </li>
  );

  return (
    <>
      {canManage ? (
        <SettingsSection title={T.title} description={T.manageDescription}>
          {requests.length === 0 ? (
            <ExplainEmpty
              icon={HandCoins}
              title={T.title}
              description={T.empty}
              className="rounded-xl border"
            />
          ) : (
            <ul className="flex flex-col gap-2">{requests.map(item)}</ul>
          )}
        </SettingsSection>
      ) : (
        <SettingsSection
          title={T.askTitle}
          description={T.askDescription}
          action={
            myOpen ? null : (
              <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
                {T.ask}
              </Button>
            )
          }
        >
          {requests.length ? <ul className="flex flex-col gap-2">{requests.map(item)}</ul> : null}
        </SettingsSection>
      )}

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{T.askTitle}</DialogTitle>
            <DialogDescription>{T.askDescription}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${ids}-reason`}>{T.reasonLabel}</FieldLabel>
            <Textarea
              id={`${ids}-reason`}
              value={reason}
              maxLength={REASON_MAX}
              placeholder={T.reasonPlaceholder}
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldDescription>
              {fill(T.count, { count: [...reason].length, max: REASON_MAX })}
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              {T.back}
            </Button>
            <Button disabled={pending || !reasonOk} onClick={send}>
              {T.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={declining !== null} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{T.declineTitle}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">{declining?.reason}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${ids}-note`}>{T.noteLabel}</FieldLabel>
            <Textarea
              id={`${ids}-note`}
              value={note}
              maxLength={REASON_MAX}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)}>
              {T.back}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={decline}>
              {T.confirmDecline}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approving !== null} onOpenChange={(o) => !o && closeApprove()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{T.approveTitle}</DialogTitle>
            <DialogDescription>{T.approveDescription}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm whitespace-pre-line">{approving?.reason}</p>
          {scopes.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${ids}-scope`}>{T.quotaScope}</FieldLabel>
                <Select value={raiseScope} onValueChange={(v) => setRaiseScope(v ?? '')}>
                  <SelectTrigger id={`${ids}-scope`}>
                    <SelectValue placeholder={t.cosmos.quotas.pickScope} />
                  </SelectTrigger>
                  <SelectContent>
                    {scopes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {quotaScopeLabel(t.cosmos.quotas, s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${ids}-percent`}>{T.quotaAdd}</FieldLabel>
                <Input
                  id={`${ids}-percent`}
                  inputMode="decimal"
                  value={raisePercent}
                  onChange={(e) => setRaisePercent(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeApprove}>
              {T.back}
            </Button>
            {scopes.length ? (
              <Button variant="outline" disabled={pending || !raiseOk} onClick={approveRaise}>
                {T.approveQuota}
              </Button>
            ) : null}
            <Button disabled={pending || !packages.length} onClick={approve}>
              {T.approve}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canManage ? <PurchaseDialog open={buying} onOpenChange={setBuying} packages={packages} /> : null}
    </>
  );
}
