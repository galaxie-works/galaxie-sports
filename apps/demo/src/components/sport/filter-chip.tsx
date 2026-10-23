'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Chip de filtro (temporada, rodada) que leva junto os parâmetros de `keep` da URL atual: trocar a
 * temporada na aba de jogos continua na aba de jogos (a aba muda a URL sem passar pelo servidor).
 * O chip ativo fica à vista numa fileira que rola na horizontal (a rodada 32 de 38 não some à direita).
 */
export function FilterChip({
  href,
  active,
  keep = [],
  children,
}: {
  href: string;
  active: boolean;
  keep?: string[];
  children: React.ReactNode;
}) {
  const current = useSearchParams();
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = ref.current;
    const row = el?.parentElement;
    // só a fileira rola (scrollLeft): a página não se mexe na vertical
    if (!active || !el || !row || row.scrollWidth <= row.clientWidth) return;
    const offset = el.getBoundingClientRect().left - row.getBoundingClientRect().left;
    row.scrollLeft += offset - (row.clientWidth - el.offsetWidth) / 2;
  }, [active]);
  const [path, search = ''] = href.split('?');
  const query = new URLSearchParams(search);
  for (const key of keep) {
    const value = current.get(key);
    if (value !== null && !query.has(key)) query.set(key, value);
  }
  const target = query.size ? `${path}?${query}` : path!;
  return (
    <Link
      ref={ref}
      href={target}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors',
        active ? 'bg-foreground text-background border-transparent' : 'hover:bg-accent',
      )}
    >
      {children}
    </Link>
  );
}
