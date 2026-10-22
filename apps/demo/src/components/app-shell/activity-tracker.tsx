'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { trailPosition } from '@/lib/trail';

/**
 * Avisa o servidor de cada página aberta (para a aba Atividade do painel de usuários). Espera o título
 * da página assentar (as páginas carregam em streaming) e manda o caminho, o título e a posição na
 * trilha de navegação (de onde o usuário veio e a profundidade).
 */
export function ActivityTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { label, from, depth } = trailPosition(pathname);
      // O título da página (nome do time, da competição…) diz mais que o <title>. Vem da trilha; sem
      // ela, do cabeçalho visível (páginas anteriores ficam montadas e escondidas no DOM).
      const heading = [...document.querySelectorAll('header h1')].find((h) => h.getClientRects().length);
      void fetch('/api/atividade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: pathname,
          title: label || heading?.textContent?.trim() || document.title,
          from,
          depth,
        }),
        keepalive: true,
      }).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}
