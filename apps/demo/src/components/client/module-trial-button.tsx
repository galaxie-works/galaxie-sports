'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { startModuleTrialAction } from '@/app/[locale]/(app)/client/plans/actions';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * "Ativar teste de N dias" num cartão `available` da loja (F3, decisão 9). A ação confere tudo de novo no servidor
 * (cargo, estado da conta, o que a loja oferece); aqui só o clique, o aviso e a recarga da tela.
 */
export function ModuleTrialButton({ module, days }: { module: string; days: number }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const p = t.client.planStore;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await startModuleTrialAction({ module });
            if (!res.ok) return void setError(res.error ?? t.client.errors.generic);
            const date = res.endsAt
              ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(res.endsAt))
              : '';
            toast.success(fill(p.trialStarted, { date }));
            router.refresh();
          });
        }}
      >
        {pending ? <Spinner /> : null}
        {fill(p.startTrial, { days })}
      </Button>
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
    </div>
  );
}
