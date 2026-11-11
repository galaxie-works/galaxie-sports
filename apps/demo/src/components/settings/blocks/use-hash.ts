'use client';

import { useSyncExternalStore } from 'react';

/**
 * O hash da URL sem o `#` (`/ajustes/agenda#SCHEDULE_X`, do "ver em…" e da busca). No servidor e na hidratação é
 * vazio, então nada diverge; depois acompanha as mudanças do hash.
 */
export function useHash(): string {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener('hashchange', notify);
      return () => window.removeEventListener('hashchange', notify);
    },
    () => decodeURIComponent(window.location.hash.slice(1)),
    () => '',
  );
}
