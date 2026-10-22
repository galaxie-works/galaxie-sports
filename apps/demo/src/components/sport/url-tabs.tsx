'use client';

import { useState } from 'react';

import { Tabs } from '@/components/ui/tabs';

/**
 * Abas cuja aba ativa vai para a URL (`?<param>=<valor>`), para o link levar direto a ela. O servidor lê o
 * parâmetro e manda o valor inicial; a troca de aba só reescreve a URL (`history.replaceState`, que o
 * Next sincroniza com `useSearchParams`), sem nova requisição ao servidor. O conteúdo das abas vem pronto
 * do servidor, como `children`.
 */
export function UrlTabs({
  param,
  value: initial,
  className,
  children,
}: {
  param: string;
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const v = String(next);
        setValue(v);
        const url = new URL(window.location.href);
        url.searchParams.set(param, v);
        window.history.replaceState(window.history.state, '', url);
      }}
      className={className}
    >
      {children}
    </Tabs>
  );
}
