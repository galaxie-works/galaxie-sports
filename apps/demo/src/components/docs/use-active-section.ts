'use client';

import { useEffect, useState } from 'react';

/** Altura do cabeçalho fixo + folga: a seção "ativa" é a última cujo topo passou daqui. */
const OFFSET_PX = 96;

/**
 * Seção visível da página (scroll-spy), entre as âncoras `ids`: a última cujo título já passou do
 * cabeçalho fixo. No fim da página vale a última (seções curtas no fim nunca chegariam ao topo).
 */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) {
      setActive(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      // Páginas visitadas antes ficam montadas e escondidas no DOM: vale só a âncora visível.
      const elements = list
        .map((id) =>
          [...document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)].find(
            (el) => el.getClientRects().length > 0,
          ),
        )
        .filter((el): el is HTMLElement => !!el);
      if (!elements.length) return setActive(null);
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) return setActive(elements.at(-1)!.id);
      let current: string | null = null;
      for (const el of elements) {
        if (el.getBoundingClientRect().top - OFFSET_PX <= 0) current = el.id;
        else break;
      }
      setActive(current ?? elements[0]!.id);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);

  return active;
}
