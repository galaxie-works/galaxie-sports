'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  ActionNotice,
  ExplainEmpty,
  SettingOption,
  SettingsSection,
  UsageMeter,
} from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { disableCosmosAction, enableCosmosAction, saveAutoRecharge } from '@/lib/cosmos/actions';
import type { CosmosOverviewData } from '@/lib/cosmos/data';
import { balanceNotice } from '@/lib/cosmos/data-utils';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { formatPrice, PurchaseDialog } from './purchase-dialog';
import { PurchaseResult } from './purchase-result';
import { UsageChart } from './usage-chart';

type Wallet = NonNullable<CosmosOverviewData['wallet']>;

/** Créditos da recarga atual (o saldo no começo do ciclo); nunca abaixo do saldo de agora. */
const cycleTotal = (w: Wallet) => Math.max(w.cycleBase, w.available + w.reserved);

function BalanceNotice({ wallet, onRecharge }: { wallet: Wallet; onRecharge: () => void }) {
  const { t, locale } = useI18n();
  const T = t.cosmos.overview.notices;
  const kind = balanceNotice(wallet);
  if (!kind) return null;
  const n = new Intl.NumberFormat(locale);
  const recharge = (
    <Button size="sm" onClick={onRecharge}>
      {t.cosmos.overview.recharge}
    </Button>
  );
  if (kind === 'trial')
    return (
      <ActionNotice tone="info" title={T.trialTitle}>
        {fill(T.trial, {
          credits: n.format(wallet.trialRemaining),
          date: wallet.trialExpiresAt
            ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(wallet.trialExpiresAt))
            : '',
        })}
      </ActionNotice>
    );
  if (kind === 'blocked')
    return (
      <ActionNotice tone="error" title={T.blockedTitle}>
        {T.blocked}
      </ActionNotice>
    );
  if (kind === 'depleted')
    return (
      <ActionNotice tone="error" title={T.depletedTitle} action={recharge}>
        {T.depleted}
      </ActionNotice>
    );
  return (
    <ActionNotice tone="warning" title={T.lowTitle} action={recharge}>
      {kind === 'low90' ? T.low90 : T.low80}
    </ActionNotice>
  );
}

function AutoRechargeOption({ data }: { data: CosmosOverviewData }) {
  const { t, locale } = useI18n();
  const T = t.cosmos.autoRecharge;
  const router = useRouter();
  const ids = useId();
  const current = data.autoRecharge;
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [packageId, setPackageId] = useState(current?.packageId ?? data.packages[0]?.id ?? '');
  const [threshold, setThreshold] = useState(String(current?.thresholdCredits ?? ''));
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();
  const n = new Intl.NumberFormat(locale);
  const items = data.packages.map((p) => ({
    value: p.id,
    label: `${p.name} · ${fill(t.cosmos.purchase.credits, { credits: n.format(p.credits) })} · ${formatPrice(locale, p.priceCents, p.currency)}`,
  }));

  const save = (nextEnabled: boolean) =>
    startTransition(async () => {
      const r = await saveAutoRecharge({
        enabled: nextEnabled,
        packageId,
        thresholdCredits: Number(threshold),
        accepted,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setEnabled(nextEnabled);
      setAccepted(false);
      toast.success(T.saved);
      router.refresh();
    });

  return (
    <SettingOption
      title={T.switch}
      description={T.switchDescription}
      checked={enabled}
      // desligar salva na hora; ligar abre as travas para escolher o pacote, o limite e dar o aceite
      onCheckedChange={(next) => (next ? setEnabled(true) : save(false))}
      disabled={pending || !data.packages.length}
      allows={T.description}
      safety={current?.lastFailureReason ? fill(T.failure, { reason: current.lastFailureReason }) : undefined}
      locks={
        data.packages.length ? (
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor={`${ids}-package`}>{T.package}</FieldLabel>
              <Select items={items} value={packageId} onValueChange={(v) => setPackageId(String(v ?? ''))}>
                <SelectTrigger id={`${ids}-package`} className="w-full">
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
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-threshold`}>{T.threshold}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={`${ids}-threshold`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <InputGroupAddon align="inline-end">{T.thresholdUnit}</InputGroupAddon>
              </InputGroup>
            </Field>
            <div className="flex items-start gap-2">
              <Checkbox
                id={`${ids}-consent`}
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
              />
              <Label htmlFor={`${ids}-consent`} className="text-sm leading-snug font-normal">
                {T.consent}
              </Label>
            </div>
            <p className="text-muted-foreground text-xs">
              {current?.hasCard ? T.hasCard : T.noCard}
              {current?.acceptedAt
                ? ` ${fill(T.acceptedBy, {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                      new Date(current.acceptedAt),
                    ),
                  })}`
                : ''}
            </p>
            <div>
              <Button
                size="sm"
                disabled={pending || !accepted || !(Number(threshold) > 0)}
                onClick={() => save(true)}
              >
                {T.save}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{T.noPackages}</p>
        )
      }
    />
  );
}

/**
 * Visão geral da Cosmos (#995): ligar, o estado do saldo com Recarregar, os créditos disponíveis com a
 * compra, os resultados da semana e a recarga automática. Tudo do kit de blocos (#990).
 */
export function CosmosOverview({
  data,
  purchase,
}: {
  data: CosmosOverviewData;
  /** Volta do Checkout do Stripe (`?purchase=&status=`). */
  purchase: { id: string; status: 'success' | 'canceled' } | null;
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.overview;
  const router = useRouter();
  const [buying, setBuying] = useState(false);
  const [pending, startTransition] = useTransition();
  const wallet = data.wallet;
  const on = Boolean(wallet?.enabled);
  const n = new Intl.NumberFormat(locale);

  const toggle = (next: boolean) =>
    startTransition(async () => {
      const r = next ? await enableCosmosAction() : await disableCosmosAction();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(next ? T.enabled : T.disabled);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      {purchase ? (
        <PurchaseResult purchaseId={purchase.id} returned={purchase.status} onRetry={() => setBuying(true)} />
      ) : null}

      <SettingsSection title={T.title} description={T.description}>
        <SettingOption
          title={T.enable}
          description={T.enableDescription}
          checked={on}
          onCheckedChange={toggle}
          disabled={pending}
          safety={wallet?.trialGranted ? undefined : fill(T.enableSafety, data.trial)}
        />
      </SettingsSection>

      {wallet ? (
        <>
          <SettingsSection
            title={T.balanceTitle}
            description={T.balanceDescription}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBuying(true)}
                disabled={!data.packages.length}
              >
                {T.manage}
              </Button>
            }
          >
            <BalanceNotice wallet={wallet} onRecharge={() => setBuying(true)} />
            {/* o medidor conta o que já foi usado desta recarga; o saldo disponível vai no rótulo */}
            <UsageMeter
              label={`${T.available}: ${n.format(wallet.available)}`}
              used={Math.max(0, cycleTotal(wallet) - wallet.available)}
              total={cycleTotal(wallet)}
            />
            {wallet.reserved > 0 ? (
              <p className="text-muted-foreground text-xs">
                {fill(T.reserved, { credits: n.format(wallet.reserved) })}
              </p>
            ) : null}
          </SettingsSection>

          <SettingsSection title={T.weekTitle}>
            <UsageChart
              title={t.cosmos.usage.chartTitle}
              description={T.weekDescription}
              data={data.week}
              empty={t.cosmos.usage.chartEmpty}
            />
            <ExplainEmpty
              icon={Sparkles}
              title={T.weekTitle}
              description={T.moderationSoon}
              className="rounded-xl border"
            />
          </SettingsSection>

          <SettingsSection
            title={t.cosmos.autoRecharge.title}
            description={t.cosmos.autoRecharge.description}
          >
            <AutoRechargeOption data={data} />
          </SettingsSection>
        </>
      ) : (
        <ExplainEmpty
          icon={Sparkles}
          title={T.emptyTitle}
          description={fill(T.emptyDescription, { credits: n.format(data.trial.credits) })}
          className="rounded-xl border"
        />
      )}

      <PurchaseDialog open={buying} onOpenChange={setBuying} packages={data.packages} />
    </div>
  );
}
