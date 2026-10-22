'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Avisa o servidor de cada página aberta (para a aba Atividade do painel de usuários). Espera o título
 * da página assentar (as páginas carregam em streaming) e manda o caminho e o título.
 */
export function ActivityTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch('/api/atividade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // O título do cabeçalho da página (nome do time, da competição…) diz mais que o <title>.
        body: JSON.stringify({
          path: pathname,
          title: document.querySelector('header h1')?.textContent?.trim() || document.title,
        }),
        keepalive: true,
      }).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}
