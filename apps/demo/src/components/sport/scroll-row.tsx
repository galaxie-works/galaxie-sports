'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Fileira que rola na horizontal sem a barra de rolagem nativa: as bordas esmaecem e ganham setas
 * quando há mais conteúdo daquele lado (roda do mouse, toque e teclado continuam rolando). Os filhos
 * ficam direto no contêiner que rola: o `FilterChip` ativo usa o pai para se centralizar.
 */
export function ScrollRow({
  children,
  className,
  label,
  previous,
  next,
}: {
  children: React.ReactNode;
  className?: string;
  /** Rótulo do grupo (leitores de tela). */
  label?: string;
  /** Rótulos das setas. */
  previous: string;
  next: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [update]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const arrow =
    'bg-background/90 text-muted-foreground hover:text-foreground absolute top-1/2 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-opacity sm:flex';

  return (
    <div className="relative [contain:inline-size]">
      <div
        ref={ref}
        role="group"
        aria-label={label}
        className={cn(
          'flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          edges.start && edges.end
            ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]'
            : edges.start
              ? '[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]'
              : edges.end
                ? '[mask-image:linear-gradient(to_left,transparent,black_2.5rem)]'
                : '',
          className,
        )}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={previous}
        onClick={() => page(-1)}
        className={cn(arrow, 'left-0', !edges.start && 'pointer-events-none opacity-0')}
        tabIndex={edges.start ? 0 : -1}
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label={next}
        onClick={() => page(1)}
        className={cn(arrow, 'right-0', !edges.end && 'pointer-events-none opacity-0')}
        tabIndex={edges.end ? 0 : -1}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
