'use client';

import { Check, ExternalLink, Minus, X } from 'lucide-react';

import { Badge } from '@/components/reui/badge';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { CHECK_KEYS, type CheckResult, type SourceTier, type VerificationView } from '@/lib/lineup/types';
import { cn } from '@/lib/utils';

const TIER_BADGE = {
  official: 'success-light',
  comparator: 'warning-light',
  press: 'warning-light',
  other: 'warning-light',
  discarded: 'destructive-light',
} as const satisfies Record<SourceTier, string>;

const RESULT_ICON = { pass: Check, fail: X, skip: Minus } as const satisfies Record<CheckResult, unknown>;

/** Preço com a moeda, no idioma da tela. */
function useMoney() {
  const { locale } = useI18n();
  return (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(
        amount,
      );
    } catch {
      return `${amount} ${currency}`;
    }
  };
}

/**
 * O que o validador da pesquisa conferiu num plano ou vínculo: preço com moeda (plano), nível da fonte
 * e domínio final, acesso sem prova e o resultado de cada checagem, com o trecho da fonte.
 */
export function VerificationCell({
  verification,
  price,
  access,
  isPlan,
}: {
  verification: VerificationView | null | undefined;
  price?: { amount: number; currency: string } | null;
  access?: string | null;
  isPlan: boolean;
}) {
  const { t } = useI18n();
  const V = t.lineup.admin.verification;
  const money = useMoney();
  if (!verification && !isPlan && access !== 'unverified')
    return <span className="text-muted-foreground text-xs">{access ? '—' : ''}</span>;
  const v = verification;
  const claimed = v?.claimed?.amount != null ? money(v.claimed.amount, v.claimed.currency ?? 'USD') : null;
  return (
    <div className="flex max-w-72 min-w-48 flex-col gap-1 text-xs">
      {isPlan ? (
        <span className={cn('font-medium', !price && 'text-muted-foreground')}>
          {price ? money(price.amount, price.currency) : V.noPrice}
          {!price && claimed ? (
            <span className="text-muted-foreground font-normal">
              {' '}
              · {fill(V.claimed, { price: claimed })}
            </span>
          ) : null}
        </span>
      ) : null}
      {v ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {v.tier ? (
              <Badge variant={TIER_BADGE[v.tier]}>{V.tiers[v.tier]}</Badge>
            ) : (
              <Badge variant="destructive-light">{V.unresolved}</Badge>
            )}
            <Badge variant={v.verified ? 'success-light' : 'outline'}>
              {v.verified ? V.verified : V.unverified}
            </Badge>
            {v.finalUrl && v.finalHost ? (
              <a
                href={v.finalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
              >
                {v.finalHost}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
          <ul className="flex flex-col gap-0.5" aria-label={t.lineup.admin.table.verification}>
            {CHECK_KEYS.filter((k) => v.checks[k]).map((k) => {
              const r = v.checks[k]!;
              const Icon = RESULT_ICON[r];
              return (
                <li
                  key={k}
                  className={cn(
                    'flex items-center gap-1',
                    r === 'fail'
                      ? 'text-destructive'
                      : r === 'pass'
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-3 shrink-0" aria-hidden />
                  <span>
                    {V.checks[k]}
                    <span className="sr-only">: {V.results[r]}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {v.excerpt ? (
            <details className="text-muted-foreground">
              <summary className="hover:text-foreground cursor-pointer">{V.excerpt}</summary>
              <p className="mt-0.5 whitespace-normal italic">“{v.excerpt}”</p>
            </details>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">{V.none}</span>
      )}
      {access === 'unverified' ? <span className="text-warning">{V.unverifiedHint}</span> : null}
    </div>
  );
}
