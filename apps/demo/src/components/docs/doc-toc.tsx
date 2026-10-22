'use client';

import { ArrowUp, Link2 } from 'lucide-react';

import type { DocSectionRef } from '@/lib/docs';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

import { absoluteUrl, copyWithToast } from './copy-to-clipboard';
import { useActiveSection } from './use-active-section';

/** Sumário da página ("Nesta página"), à direita no desktop, com a seção atual marcada pelo scroll. */
export function DocToc({ sections }: { sections: DocSectionRef[] }) {
  const T = useI18n().t.docsUi;
  const active = useActiveSection(sections.map((s) => s.id));
  if (!sections.length) return null;
  return (
    <nav aria-label={T.onThisPage} className="flex flex-col gap-3 text-sm">
      <p className="text-foreground text-xs font-medium">{T.onThisPage}</p>
      <ul className="flex flex-col border-l">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? 'location' : undefined}
              className={cn(
                '-ml-px block border-l py-1 pl-3 text-[0.8125rem] leading-snug transition-colors',
                active === s.id
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          history.replaceState(null, '', window.location.pathname);
        }}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-xs"
      >
        <ArrowUp className="size-3" aria-hidden /> {T.backToTop}
      </a>
    </nav>
  );
}

/** Âncora ao lado do título da seção: leva ao `#id` e copia o link. */
export function HeadingAnchor({ id, title }: { id: string; title: string }) {
  const T = useI18n().t.docsUi;
  return (
    <a
      href={`#${id}`}
      aria-label={fill(T.anchor, { title })}
      title={T.copyLink}
      onClick={() =>
        void copyWithToast(absoluteUrl(`${window.location.pathname}#${id}`), {
          done: T.linkCopied,
          failed: T.copyFailed,
        })
      }
      className="text-muted-foreground hover:text-primary focus-visible:text-primary rounded-sm opacity-0 transition-opacity group-hover/anchor:opacity-100 focus-visible:opacity-100"
    >
      <Link2 className="size-4" aria-hidden />
    </a>
  );
}
