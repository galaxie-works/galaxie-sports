'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

/** Quanto tempo a linha fica destacada ao chegar pela busca. */
export const HIGHLIGHT_MS = 2000;
/** Quanto tempo espera a linha aparecer (a página chega em partes pelo Suspense). */
const WAIT_MS = 8000;

/** Classes do destaque; a linha precisa de `transition-colors` (sem `transition-all`) para o fade. */
const HIGHLIGHT = ['bg-primary/5', 'transition-colors'];

/**
 * Chave da âncora (`#AI_DAILY_USD_BUDGET` → `AI_DAILY_USD_BUDGET`); só chaves do registro (maiúsculas, `_`). Âncora
 * mal formada (`#%`, que o `decodeURIComponent` recusa) não é chave: devolve null em vez de derrubar a página.
 */
export function anchorKey(hash: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return null;
  }
  return /^[A-Z][A-Z0-9_]*$/.test(key) ? key : null;
}

/**
 * Seção recolhida cujo painel não fica montado fechado: ela declara as chaves que tem, para a busca abri-la antes
 * de a linha existir (`<Collapsible {...settingKeysProps(keys)}>`).
 */
export const settingKeysProps = (keys: readonly string[]) => ({ 'data-setting-keys': keys.join(' ') });

/**
 * Abre uma seção recolhida: `<details>` ou o collapsible do Base UI (`data-slot="collapsible"` com `data-closed`:
 * clica no gatilho dele, para o estado do React acompanhar). Devolve se abriu.
 */
export function openSection(el: HTMLElement): boolean {
  if (el instanceof HTMLDetailsElement && !el.open) {
    el.open = true;
    return true;
  }
  if (el.dataset.slot === 'collapsible' && el.hasAttribute('data-closed')) {
    const trigger = el.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    trigger?.click();
    return !!trigger;
  }
  return false;
}

/** Abre as seções recolhidas que contêm a linha. Devolve se abriu alguma. */
export function openAncestors(row: HTMLElement): boolean {
  let opened = false;
  for (let el = row.parentElement; el; el = el.parentElement) opened = openSection(el) || opened;
  return opened;
}

/** Rola até a linha e a destaca por `HIGHLIGHT_MS`; devolve a função que limpa o destaque antes da hora. */
export function revealSetting(row: HTMLElement, { smooth = true } = {}): () => void {
  const opened = openAncestors(row);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scroll = () =>
    row.scrollIntoView({ block: 'center', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  // seção que acabou de abrir: espera o painel medir a altura antes de rolar
  const frame = window.requestAnimationFrame(() =>
    opened ? window.requestAnimationFrame(scroll) : scroll(),
  );
  row.classList.add(...HIGHLIGHT);
  row.setAttribute('data-highlighted', '');
  const timer = window.setTimeout(() => {
    row.classList.remove('bg-primary/5');
    row.removeAttribute('data-highlighted');
  }, HIGHLIGHT_MS);
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    row.classList.remove('bg-primary/5');
    row.removeAttribute('data-highlighted');
  };
}

/**
 * Chegada pela busca de ajustes (#1071): com `#CHAVE` na URL, acha a linha de `id` igual à chave, abre a seção que a
 * contém, rola até ela e a destaca por 2 s. Se a linha ainda não chegou (Suspense ou seção fechada, ver
 * `settingKeysProps`), espera por ela até 8 s.
 *
 * Quando olhar a âncora: ao montar; no `hashchange` (a paleta, na mesma página, troca `location.hash`); e depois de
 * cada navegação do roteador que mude o caminho ou a busca (`?aba=ajustes#CHAVE` sobre a mesma página não remonta o
 * componente). O efeito roda depois de a navegação gravar a URL, então lê o hash novo, sem esperar timer.
 */
export function useSettingAnchor() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let observer: MutationObserver | null = null;
    let giveUp = 0;

    const stopWaiting = () => {
      observer?.disconnect();
      observer = null;
      window.clearTimeout(giveUp);
    };

    const arrive = () => {
      stopWaiting();
      cleanup?.();
      cleanup = null;
      const key = anchorKey(window.location.hash);
      if (!key) return;
      const found = document.getElementById(key);
      if (found) {
        cleanup = revealSetting(found);
        return;
      }
      // a linha ainda não existe: abre a seção que diz tê-la (painel fechado não fica montado) e espera
      const section = document.querySelector<HTMLElement>(`[data-setting-keys~="${key}"]`);
      if (section) openSection(section);
      observer = new MutationObserver(() => {
        const row = document.getElementById(key);
        if (!row) return;
        stopWaiting();
        cleanup = revealSetting(row);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      giveUp = window.setTimeout(stopWaiting, WAIT_MS);
    };

    arrive();
    window.addEventListener('hashchange', arrive);
    return () => {
      window.removeEventListener('hashchange', arrive);
      stopWaiting();
      cleanup?.();
    };
  }, [pathname, search]);
}

function SettingAnchorInner() {
  useSettingAnchor();
  return null;
}

/**
 * Componente sem tela para páginas servidor: monte uma vez na página de Ajustes. O Suspense é do `useSearchParams`
 * (dado de URL), para não tirar a página do shell estático.
 */
export function SettingAnchor() {
  return (
    <Suspense fallback={null}>
      <SettingAnchorInner />
    </Suspense>
  );
}
