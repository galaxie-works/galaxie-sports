'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ActionNotice } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { cosmosPurchaseStatus } from '@/lib/cosmos/actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

type Phase = 'processing' | 'success' | 'failed' | 'canceled';

/** Intervalo da consulta enquanto o Stripe não confirma (o Pix pode levar minutos). */
const POLL_MS = 3000;
/** Desiste de esperar depois disto; o crédito continua entrando pelo webhook. */
const POLL_LIMIT = 100;

/**
 * Volta do Checkout (`?purchase=<intenção>&status=success|canceled`): mostra "processando" e pergunta a
 * situação até o webhook confirmar, depois o resultado. "Tentar de novo" reabre a compra.
 */
export function PurchaseResult({
  purchaseId,
  returned,
  onRetry,
}: {
  purchaseId: string;
  returned: 'success' | 'canceled';
  onRetry: () => void;
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.purchase;
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>(returned === 'canceled' ? 'canceled' : 'processing');
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    if (returned === 'canceled') return;
    let tries = 0;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      tries += 1;
      const r = await cosmosPurchaseStatus(purchaseId).catch(() => null);
      if (stop) return;
      if (r?.ok && r.status === 'paid') {
        setCredits(r.credits ?? 0);
        setPhase('success');
        router.refresh();
        return;
      }
      if (r?.ok && r.status && r.status !== 'pending') {
        setPhase('failed');
        return;
      }
      if (tries < POLL_LIMIT) timer = setTimeout(check, POLL_MS);
    };
    timer = setTimeout(check, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [purchaseId, returned, router]);

  const dismiss = () => router.replace(pathname, { scroll: false });
  const n = new Intl.NumberFormat(locale);

  if (phase === 'processing')
    return (
      <ActionNotice tone="info" title={T.processingTitle}>
        {T.processing}
      </ActionNotice>
    );
  if (phase === 'success')
    return (
      <ActionNotice
        tone="info"
        title={T.successTitle}
        action={
          <Button size="sm" variant="outline" onClick={dismiss}>
            {T.close}
          </Button>
        }
      >
        {fill(T.success, { credits: n.format(credits) })}
      </ActionNotice>
    );
  return (
    <ActionNotice
      tone={phase === 'failed' ? 'error' : 'warning'}
      title={phase === 'failed' ? T.failedTitle : T.canceledTitle}
      action={
        <Button
          size="sm"
          onClick={() => {
            dismiss();
            onRetry();
          }}
        >
          {T.retry}
        </Button>
      }
    >
      {phase === 'failed' ? T.failed : T.canceled}
    </ActionNotice>
  );
}
