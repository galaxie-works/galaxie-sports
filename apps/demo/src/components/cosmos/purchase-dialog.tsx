'use client';

import type { CreditPackageView } from '@galaxie/cosmos';
import { useState, useTransition } from 'react';

import { ActionNotice, StepDialog, type DialogStep } from '@/components/settings';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { startCosmosCheckout } from '@/lib/cosmos/actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export function formatPrice(locale: string, cents: number, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/**
 * Compra de créditos em janela com passos: escolher o pacote (cartões de opção do exemplo ReUI
 * c-radio-group-17, cópia fiel em `components/examples/c-radio-group-17.tsx`) e ir para o Checkout do
 * Stripe. O crédito entra pelo webhook; a volta para a página mostra o resultado (`PurchaseResult`).
 */
export function PurchaseDialog({
  open,
  onOpenChange,
  packages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packages: CreditPackageView[];
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.purchase;
  const n = new Intl.NumberFormat(locale);
  const [value, setValue] = useState<string>(packages[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = packages.find((p) => p.id === value) ?? null;

  const pay = () => {
    if (!chosen) return;
    setError(null);
    startTransition(async () => {
      const r = await startCosmosCheckout(chosen.id);
      if (r.ok && r.url) window.location.assign(r.url);
      else setError(r.error ?? t.cosmos.checkout.errors.generic);
    });
  };

  const steps: DialogStep[] = [
    {
      title: T.chooseTitle,
      description: T.chooseDescription,
      canContinue: Boolean(chosen),
      content: packages.length ? (
        <RadioGroup value={value} onValueChange={(v) => setValue(String(v))} className="w-full">
          {packages.map((plan) => (
            <FieldLabel key={plan.id} htmlFor={`cosmos-package-${plan.id}`}>
              <Field orientation="horizontal">
                <RadioGroupItem value={plan.id} id={`cosmos-package-${plan.id}`} />
                <FieldContent>
                  <FieldTitle className="flex items-center justify-between">
                    <span>{plan.name}</span>
                    <span className="text-sm font-semibold">
                      {formatPrice(locale, plan.priceCents, plan.currency)}
                    </span>
                  </FieldTitle>
                  <FieldDescription>{fill(T.credits, { credits: n.format(plan.credits) })}</FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
      ) : (
        <p className="text-muted-foreground text-sm">{T.noPackages}</p>
      ),
    },
    {
      title: T.confirmTitle,
      description: T.confirmDescription,
      canContinue: Boolean(chosen),
      content: chosen ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">
            {fill(T.summary, {
              credits: n.format(chosen.credits),
              price: formatPrice(locale, chosen.priceCents, chosen.currency),
            })}
          </p>
          <p className="text-muted-foreground">{chosen.currency === 'brl' ? T.methodsBr : T.methodsCard}</p>
          {chosen.currency === 'brl' ? (
            <p className="text-muted-foreground">{t.cosmos.checkout.pixReceipt}</p>
          ) : null}
          {error ? <ActionNotice tone="error">{error}</ActionNotice> : null}
        </div>
      ) : null,
    },
  ];

  return (
    <StepDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      steps={steps}
      onFinish={pay}
      finishLabel={T.pay}
      pending={pending}
    />
  );
}
