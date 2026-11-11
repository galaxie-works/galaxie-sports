'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { saveSetting } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { useI18n } from '@/lib/i18n/client';

/**
 * Grava várias chaves com a mesma ação de sempre (`saveSetting`), uma por vez e na ordem: cada uma fica no
 * histórico como hoje. Para na primeira recusa (o toast diz qual chave) e atualiza a página no fim.
 */
export function useSaveSettings() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const saveAll = (changes: Readonly<Record<string, string>>, ok: string, after?: () => void) =>
    startTransition(async () => {
      for (const [key, value] of Object.entries(changes)) {
        const res = await saveSetting(key, value);
        if (!res.ok) {
          toast.error(`${key}: ${res.error ?? t.ops.feedback.failed}`);
          router.refresh();
          return;
        }
        if (res.warning) toast.warning(res.warning);
      }
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, saveAll };
}
