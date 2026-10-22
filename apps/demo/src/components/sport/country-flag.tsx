'use client';

import type { Navigation } from '@galaxie/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

const noopSubscribe = () => () => {};

/**
 * Bandeiras dos países da navegação, vindas de /v1/navigation (pelo proxy autenticado da demo).
 * Buscadas no navegador e guardadas por 1 hora: o build não depende da API e todas as listas
 * compartilham a mesma resposta.
 */
function useFlags() {
  return useQuery({
    queryKey: ['navigation-flags'],
    queryFn: async () => {
      const res = await fetch('/api/galaxie/v1/navigation?locale=pt-BR');
      if (!res.ok) throw new Error(`navigation ${res.status}`);
      const nav = (await res.json()) as Navigation;
      return Object.fromEntries(nav.countries.map((c) => [c.code.toUpperCase(), c.flag])) as Record<
        string,
        string | null
      >;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

const SIZES = { sm: 'h-3.5 w-5', md: 'h-4 w-6', lg: 'h-6 w-9' } as const;

/** Bandeira do país; enquanto carrega (ou se faltar), mostra o código num chip do mesmo tamanho. */
export function CountryFlag({
  code,
  size = 'sm',
  className,
}: {
  code: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { data } = useFlags();
  // Só depois de montar: o servidor não tem as bandeiras (elas vêm do navegador), e usar o cache
  // já na hidratação faria o HTML divergir.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const flag = mounted ? data?.[code.toUpperCase()] : undefined;
  if (flag) {
    return (
      <img
        src={flag}
        alt=""
        draggable={false}
        className={cn(SIZES[size], 'shrink-0 rounded-[2px] object-cover ring-1 ring-white/10', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        SIZES[size],
        'bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-[2px] font-mono text-[9px]',
        className,
      )}
    >
      {code.replace('GB-', '')}
    </span>
  );
}
