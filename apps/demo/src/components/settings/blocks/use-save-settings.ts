'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import {
  resetSetting,
  saveSetting,
  type OpsActionResult,
} from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { useI18n } from '@/lib/i18n/client';

/**
 * Grava várias chaves com as ações de sempre (`resetSetting` e `saveSetting`), uma por vez e na ordem: cada uma fica
 * no histórico como hoje. Primeiro apaga as sobrescritas de `reset`, depois grava `save`. Para na primeira recusa
 * (o toast diz qual chave) e atualiza a página no fim.
 */
export function useSaveSettings() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const apply = (
    ops: { save?: Readonly<Record<string, string>>; reset?: readonly string[] },
    ok: string,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const steps: { key: string; run: () => Promise<OpsActionResult> }[] = [
        ...(ops.reset ?? []).map((key) => ({ key, run: () => resetSetting(key) })),
        ...Object.entries(ops.save ?? {}).map(([key, value]) => ({
          key,
          run: () => saveSetting(key, value),
        })),
      ];
      for (const step of steps) {
        const res = await step.run();
        if (!res.ok) {
          toast.error(`${step.key}: ${res.error ?? t.ops.feedback.failed}`);
          router.refresh();
          return;
        }
        if (res.warning) toast.warning(res.warning);
      }
      toast.success(ok);
      after?.();
      router.refresh();
    });
  const saveAll = (changes: Readonly<Record<string, string>>, ok: string, after?: () => void) =>
    apply({ save: changes }, ok, after);
  return { pending, apply, saveAll };
}
