'use client';

import { useEffect } from 'react';

/**
 * Leva à linha do `#hash` da URL quando o painel monta. O painel chega por streaming (atrás de Suspense), depois que o
 * navegador já procurou a âncora: sem isto, `/ajustes/fornecedor#sports` (308 das rotas antigas) ou o "ver em…" de um
 * `SettingLink` abriam a página no topo. O `scroll-mt-*` das linhas deixa a linha abaixo da barra do topo.
 * Provisório: o `SettingAnchor` (destaque da linha, rolagem entre abas) substitui este hook.
 */
export function useScrollToHashOnMount(): void {
  useEffect(() => {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
}
