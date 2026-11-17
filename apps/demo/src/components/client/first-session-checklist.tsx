'use client';

import { CircleCheck, Circle, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { CodeSnippet } from '@/components/client/code-snippet';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button, buttonVariants } from '@/components/ui/button';
import { checklistStorageKey, type ChecklistView } from '@/lib/client/checklist-shared';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * Checklist da primeira sessão no topo da visão geral (F3, decisão 10): os quatro passos do doc 02, cada um marcado
 * pela prova que o servidor leu (`lib/client/checklist.ts`). A dispensa fica no `localStorage` deste navegador, por
 * marca; nada vai ao banco. O `curl` e o embed trazem só prefixos: o texto inteiro das chaves apareceu uma vez.
 */
export function FirstSessionChecklist({ checklist }: { checklist: ChecklistView }) {
  const { t } = useI18n();
  const c = t.client.checklist;
  // começa visível e lê a dispensa depois de montar: o servidor não conhece o localStorage (sem salto de hidratação)
  const [dismissed, setDismissed] = useState(false);
  const key = checklistStorageKey(checklist.tenantId);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(key) === 'dismissed');
    } catch {
      // navegador sem armazenamento: o checklist aparece sempre
    }
  }, [key]);
  if (dismissed) return null;
  const done = checklist.steps.filter((s) => s.done).length;
  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <FrameHeader className="p-0">
            <FrameTitle>{c.title}</FrameTitle>
            <FrameDescription>{fill(c.intro, { done, total: checklist.steps.length })}</FrameDescription>
          </FrameHeader>
          <Button
            variant="ghost"
            size="sm"
            aria-label={c.dismiss}
            onClick={() => {
              setDismissed(true);
              try {
                window.localStorage.setItem(key, 'dismissed');
              } catch {
                // sem armazenamento: dispensa só nesta tela
              }
            }}
          >
            <X aria-hidden className="size-4" />
            {c.dismiss}
          </Button>
        </div>
        <ol className="flex flex-col gap-4">
          {checklist.steps.map((step, i) => {
            const s = c.steps[step.id];
            const Icon = step.done ? CircleCheck : Circle;
            const snippet =
              step.id === 'call' ? checklist.curl : step.id === 'widget' ? checklist.embed : null;
            const missing =
              step.id === 'call' && !checklist.curl
                ? c.steps.call.noKey
                : step.id === 'widget' && !checklist.embed
                  ? c.steps.widget.noWidget
                  : null;
            return (
              <li key={step.id} className="flex gap-3">
                <Icon
                  aria-hidden
                  className={
                    step.done
                      ? 'text-success mt-0.5 size-5 shrink-0'
                      : 'text-muted-foreground mt-0.5 size-5 shrink-0'
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {i + 1}. {s.title}
                    </span>
                    <Badge variant={step.done ? 'success-light' : 'secondary'} radius="full">
                      {step.done ? c.done : c.pending}
                    </Badge>
                  </div>
                  {!step.done ? (
                    <>
                      <p className="text-muted-foreground text-sm">{missing ?? s.body}</p>
                      {snippet ? <CodeSnippet code={snippet} /> : null}
                      <div>
                        <Link href={step.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                          {s.action}
                        </Link>
                      </div>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </FramePanel>
    </Frame>
  );
}
