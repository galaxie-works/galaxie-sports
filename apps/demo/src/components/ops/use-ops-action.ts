'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import type { OpsActionResult } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { useI18n } from '@/lib/i18n/client';

/** Roda uma ação do servidor com toast e atualiza a página. */
export function useOpsAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<OpsActionResult>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? t.ops.feedback.failed);
      if (res.warning) toast.warning(res.warning);
      else toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, run };
}
