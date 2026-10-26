'use client';

import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { useInExample } from '@/components/example/example-provider';
import { FLAGS_QUERY_KEY, fetchFlags } from '@/lib/country-flags';
import { cn } from '@/lib/utils';

const noopSubscribe = () => () => {};

/**
 * Bandeiras de todos os países do catálogo, vindas de /v1/countries (pelo proxy autenticado da demo):
 * não só os da navegação, porque competição, time e piloto podem ser de qualquer país (Nova Zelândia).
 * Buscadas no navegador e guardadas por 1 hora: o build não depende da API e todas as listas
 * compartilham a mesma resposta. No exemplo público as bandeiras já vêm no cache (`ExampleProvider`)
 * e a busca fica desligada: o `staleTime` daqui sobrepõe o do provider e, depois de 1 hora, refaria
 * a chamada (um 401 do proxy, sem sessão).
 */
export function flagsQuery(inExample: boolean) {
  return {
    queryKey: FLAGS_QUERY_KEY,
    queryFn: () => fetchFlags(fetch),
    staleTime: 60 * 60 * 1000,
    retry: 1,
    enabled: !inExample,
  };
}

function useFlags() {
  return useQuery(flagsQuery(useInExample()));
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
