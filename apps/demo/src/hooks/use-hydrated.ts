'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * false no servidor e durante a hidratação, true depois. Para dados que só existem no navegador (React
 * Query): uma consulta que termina antes de um Suspense hidratar não pode mudar o HTML da hidratação.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
