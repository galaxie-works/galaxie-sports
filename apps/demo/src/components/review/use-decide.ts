'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/lib/i18n/client';
import { itemSegment, type ReviewAction } from '@/lib/review/types';

interface DecideOptions {
  comment?: string;
  fields?: Record<string, unknown> | null;
  /** Ação que desfaz esta (vira o botão "Desfazer" do aviso). */
  undo?: ReviewAction;
}

/** Envia uma decisão de revisão (detalhe e ações rápidas da lista), avisa o resultado e recarrega a página. */
export function useDecide(id: string) {
  const { t } = useI18n();
  const T = t.review;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const send = (action: ReviewAction, { undo, ...body }: DecideOptions = {}) =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        try {
          const res = await fetch(`/api/ajustes/revisao/${itemSegment(id)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, ...body }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            code?: string;
            data?: { unchanged: boolean };
          };
          if (!res.ok) {
            const code = json.code as keyof typeof T.errors | undefined;
            toast.error(code && code in T.errors ? T.errors[code] : T.errors.failed);
            resolve(false);
            return;
          }
          const unchanged = json.data?.unchanged;
          toast.success(
            unchanged ? T.actions.unchanged : T.actions.done[action],
            undo && !unchanged
              ? { action: { label: T.actions.undo, onClick: () => void send(undo) } }
              : undefined,
          );
          router.refresh();
          resolve(true);
        } catch {
          toast.error(T.errors.failed);
          resolve(false);
        }
      }),
    );
  return { send, pending };
}
