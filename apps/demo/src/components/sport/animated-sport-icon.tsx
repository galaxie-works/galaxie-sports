'use client';

import type { AnimationItem } from 'lottie-web';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Animações dos esportes (Lottie, cores já "assadas" para o tema por scripts/bake-lottie-icons.mjs).
 * Cada uma vira um chunk separado: só baixa quando o ícone aparece na tela.
 */
const ANIMATIONS: Record<string, () => Promise<{ default: unknown }>> = {
  football: () => import('./animated-icons/football.json'),
  basketball: () => import('./animated-icons/basketball.json'),
  nba: () => import('./animated-icons/basketball.json'),
  volleyball: () => import('./animated-icons/volleyball.json'),
  'formula-1': () => import('./animated-icons/formula-1.json'),
  mma: () => import('./animated-icons/mma.json'),
  'american-football': () => import('./animated-icons/american-football.json'),
  rugby: () => import('./animated-icons/rugby.json'),
  afl: () => import('./animated-icons/rugby.json'),
  baseball: () => import('./animated-icons/baseball.json'),
  hockey: () => import('./animated-icons/hockey.json'),
  handball: () => import('./animated-icons/handball.json'),
};

/**
 * Ícone do esporte: parado no primeiro quadro e animado ao passar o mouse (ou focar) no link/cartão que o
 * contém. Antes de carregar, no servidor e em esportes sem animação mostra o ícone estático; com "reduzir
 * movimento" do sistema, fica parado. Usa o player "light" do lottie-web, que não executa expressions.
 */
export function AnimatedSportIcon({
  slug,
  className,
  children,
}: {
  slug: string;
  className?: string;
  /** Ícone estático (ex.: Lucide) mostrado antes de a animação carregar. */
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = ANIMATIONS[slug];
    const container = ref.current;
    if (!load || !container) return;
    let anim: AnimationItem | null = null;
    let cancelled = false;
    const trigger = container.closest<HTMLElement>('a,button,[data-anim-trigger]') ?? container;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const play = () => {
      if (!anim || reduce.matches) return;
      anim.goToAndPlay(0, true);
    };

    void Promise.all([import('lottie-web/build/player/lottie_light'), load()]).then(([lottie, data]) => {
      if (cancelled) return;
      anim = lottie.default.loadAnimation({
        container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: data.default,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
      });
      anim.addEventListener('DOMLoaded', () => {
        anim?.goToAndStop(0, true);
        setReady(true);
      });
    });

    trigger.addEventListener('pointerenter', play);
    trigger.addEventListener('focusin', play);
    return () => {
      cancelled = true;
      trigger.removeEventListener('pointerenter', play);
      trigger.removeEventListener('focusin', play);
      anim?.destroy();
    };
  }, [slug]);

  return (
    <span className={cn('relative inline-flex shrink-0', className)} aria-hidden>
      <span ref={ref} className={cn('absolute inset-0 [&_svg]:!size-full', !ready && 'invisible')} />
      <span className={cn('flex size-full [&_svg]:size-full', ready && 'invisible')}>{children}</span>
    </span>
  );
}
