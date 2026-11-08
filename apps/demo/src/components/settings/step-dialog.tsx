'use client';

import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface DialogStep {
  title: ReactNode;
  description?: ReactNode;
  content: ReactNode;
  /** Pode seguir (ex.: campos válidos). Padrão: sim. */
  canContinue?: boolean;
}

/**
 * Janela com passos: título e uma frase por passo, voltar e seguir. A altura acompanha o conteúdo até
 * caber na tela (`max-h` pela altura visível); só o corpo rola, e o rodapé fica sempre à vista, mesmo
 * numa tela de 768 px de altura.
 */
export function StepDialog({
  open,
  onOpenChange,
  steps,
  onFinish,
  finishLabel,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: DialogStep[];
  onFinish: () => void;
  finishLabel?: string;
  pending?: boolean;
}) {
  const { t } = useI18n();
  const T = t.settings.steps;
  const [index, setIndex] = useState(0);
  // Fechou por fora (o pai trocou `open` depois de concluir): a próxima abertura volta ao passo 1.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setIndex(0);
  }
  const total = steps.length;
  const current = Math.min(index, total - 1);
  const step = steps[current];
  const last = current === total - 1;

  const change = (next: boolean) => {
    if (!next) setIndex(0);
    onOpenChange(next);
  };

  if (!step) return null;
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent data-slot="step-dialog" className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {fill(T.progress, { current: current + 1, total })}
          </p>
          <DialogTitle>{step.title}</DialogTitle>
          {step.description ? <DialogDescription>{step.description}</DialogDescription> : null}
        </DialogHeader>
        <div data-slot="step-dialog-body" className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {step.content}
        </div>
        <DialogFooter className="shrink-0">
          {current > 0 ? (
            <Button variant="outline" disabled={pending} onClick={() => setIndex(current - 1)}>
              {T.back}
            </Button>
          ) : (
            <Button variant="outline" disabled={pending} onClick={() => change(false)}>
              {T.cancel}
            </Button>
          )}
          {last ? (
            <Button disabled={pending || step.canContinue === false} onClick={onFinish}>
              {pending ? <Spinner /> : null}
              {finishLabel ?? T.finish}
            </Button>
          ) : (
            <Button disabled={step.canContinue === false} onClick={() => setIndex(current + 1)}>
              {T.next}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
