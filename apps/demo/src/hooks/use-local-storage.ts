'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Avisa os componentes da mesma aba (o evento `storage` do navegador só chega às outras abas). */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** O que foi gravado nesta aba: vale mesmo quando o navegador recusa o armazenamento (janela anônima, bloqueio). */
const memory = new Map<string, string | null>();

/** Leitura protegida: janela anônima, armazenamento bloqueado ou cheio não quebram a tela. */
function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Um texto lembrado no navegador (`localStorage`), para preferências de tela de quem vê: no servidor e na hidratação
 * vale `fallback`, depois o valor guardado. Gravar com `null` apaga. Todo acesso fica em try/catch.
 */
export function useLocalStorage(key: string, fallback: string): [string, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback(
    (next: string | null) => {
      memory.set(key, next);
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      } catch {
        // sem armazenamento: a escolha vale só até recarregar
      }
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set];
}
