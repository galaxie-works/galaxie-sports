'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { exampleHref } from '@/lib/example/pages';
import { useI18n } from '@/lib/i18n/client';

const ExampleContext = createContext(false);

/** Mensagem do exemplo (dentro do iframe da apresentação) pedindo para fechar a janela: Esc lá dentro. */
export const EXAMPLE_ESCAPE = 'galaxie-example-escape';

/** Dentro do exemplo público? (os botões "Ver código" e a busca somem lá) */
export const useInExample = () => useContext(ExampleContext);

/**
 * Moldura do exemplo público no navegador:
 * - avisa os componentes que estão no exemplo (`useInExample`);
 * - deixa as bandeiras prontas no cache (o exemplo não chama a API para buscá-las);
 * - guarda os links: destino que faz parte do exemplo vai para `/exemplo/...`; o resto avisa que é da
 *   demo completa, com o atalho para entrar;
 * - dentro da janela da apresentação (iframe), repassa o Esc para fechá-la.
 */
export function ExampleProvider({
  flags,
  locked,
  signIn,
  children,
}: {
  /** Bandeira de cada país (código → arquivo em /public/flags). */
  flags: Record<string, string>;
  locked: string;
  signIn: string;
  children: React.ReactNode;
}) {
  const { locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  // as bandeiras já vêm prontas: o CountryFlag não busca nada (sem `Date.now()` no render)
  useState(() =>
    queryClient.setQueryDefaults(['navigation-flags'], { initialData: flags, staleTime: Infinity }),
  );

  // Esc dentro do iframe não chega à janela da apresentação: avisa a página de fora
  useEffect(() => {
    if (window.parent === window) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.parent.postMessage(EXAMPLE_ESCAPE, window.location.origin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onClickCapture(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || e.defaultPrevented) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    // saídas explícitas do exemplo (apresentação, login): seguem normal
    if (a.target === '_top' || a.target === '_blank') return;
    // relativo à página atual (`?aba=jogos` continua na mesma página do exemplo)
    const url = new URL(href, window.location.href);
    // fora do site (fontes, vídeos): segue normal
    if (url.origin !== window.location.origin) return;
    e.preventDefault();
    e.stopPropagation();
    const target = exampleHref(locale, `${url.pathname}${url.search}${url.hash}`);
    if (target) {
      router.push(target);
      return;
    }
    toast(locked, {
      action: {
        label: signIn,
        onClick: () => {
          (window.top ?? window).location.href = '/login';
        },
      },
    });
  }

  return (
    <ExampleContext.Provider value={true}>
      <div className="contents" onClickCapture={onClickCapture}>
        {children}
      </div>
    </ExampleContext.Provider>
  );
}
