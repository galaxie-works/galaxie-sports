'use client';

import { useEffect, useState } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

import { usePageChromeReport } from './page-state';

export interface OnThisPageSection {
  /** `id` do elemento da seção na página. */
  id: string;
  label: string;
}

/** O índice só aparece com duas seções ou mais (com uma, ele repetiria o título). */
export const showOnThisPage = (sections: readonly OnThisPageSection[]) => sections.length >= 2;

/**
 * Seção acesa: a última cujo topo já passou da linha de leitura (um terço da tela). Puro, para o teste: recebe o
 * topo de cada seção (na ordem da página) em relação à janela.
 */
export function activeSection(
  tops: readonly { id: string; top: number }[],
  readingLine: number,
): string | null {
  let current: string | null = tops[0]?.id ?? null;
  for (const s of tops) if (s.top <= readingLine) current = s.id;
  return current;
}

/**
 * "Nesta página" (#1072): índice das seções na lateral direita, só em telas ≥ xl e com 2+ seções. Acende a seção
 * visível ao rolar (IntersectionObserver). Some no celular.
 *
 * As seções costumam chegar depois do índice (o conteúdo vem atrás de Suspense): sem elas na página, o índice espera
 * por elas (MutationObserver) e só então liga o IntersectionObserver. Também religa quando o conteúdo conta um novo
 * retrato (`updatedAt` do topo), porque o Suspense pode trocar os elementos das seções.
 */
export function OnThisPage({
  sections,
  className,
}: {
  sections: readonly OnThisPageSection[];
  className?: string;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const ids = sections.map((s) => s.id).join(' ');
  const updatedAt = usePageChromeReport()?.updatedAt;
  // muda quando as seções aparecem na página, para o efeito abaixo rodar de novo
  const [arrived, setArrived] = useState(0);

  useEffect(() => {
    const find = () =>
      ids
        .split(' ')
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => !!el);
    const els = find();
    if (els.length < 2) {
      if (ids.split(' ').length < 2) return;
      // seções ainda não montadas: espera chegarem
      const waiting = new MutationObserver(() => {
        if (find().length < 2) return;
        waiting.disconnect();
        setArrived((n) => n + 1);
      });
      waiting.observe(document.body, { childList: true, subtree: true });
      return () => waiting.disconnect();
    }
    const update = () =>
      setActive(
        activeSection(
          els.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })),
          window.innerHeight / 3,
        ),
      );
    // avisa quando uma seção cruza a faixa do terço de cima; o cálculo fica no `activeSection`
    const observer = new IntersectionObserver(update, { rootMargin: '0px 0px -66% 0px', threshold: [0, 1] });
    els.forEach((el) => observer.observe(el));
    update();
    return () => observer.disconnect();
  }, [ids, arrived, updatedAt]);

  if (!showOnThisPage(sections)) return null;
  return (
    <nav aria-label={t.ops.pageChrome.onThisPage} className={cn('hidden w-48 shrink-0 xl:block', className)}>
      <div className="sticky top-18 flex flex-col gap-2">
        <span className="text-muted-foreground text-xs font-medium">{t.ops.pageChrome.onThisPage}</span>
        <ScrollArea className="max-h-[calc(100vh-8rem)]">
          <ul className="flex flex-col gap-0.5 border-l">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={active === s.id ? 'location' : undefined}
                  className={cn(
                    '-ml-px block border-l py-1 pl-3 text-sm transition-colors',
                    active === s.id
                      ? 'border-primary text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </nav>
  );
}
