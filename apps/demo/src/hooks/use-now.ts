'use client';

import { useEffect, useState } from 'react';

/**
 * Relógio de parede que avança a cada `intervalMs` (contadores "há 4 s"). Começa `null` e só passa a
 * ter valor depois de montar: nada de `Date.now()` no render (o HTML do servidor e o da hidratação batem).
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
