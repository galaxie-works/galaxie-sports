'use client';

/**
 * Envolve cada fallback de carregamento: anuncia "Carregando…" (no idioma da página) aos leitores de
 * tela uma vez só e esconde deles os blocos do esqueleto (`skeletons.tsx`), que não têm texto.
 *
 * O aviso fica num `<span>` à parte (`sr-only`, posicionado fora do fluxo), então não entra na grade nem
 * no `gap` de quem está em volta; `className` vai para o contêiner dos blocos.
 */
import { useEffect, useState } from 'react';

import { useI18n } from '@/lib/i18n/client';

/**
 * A região viva (`role="status"`) nasce vazia e só recebe o texto depois de montada: vários leitores de
 * tela não anunciam uma região que já aparece com o texto dentro. `active={false}` a esvazia, para quem
 * mantém um aviso só e liga e desliga conforme o carregamento (o quadro ao vivo).
 */
export function LoadingAnnouncer({ active = true }: { active?: boolean }) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(id);
  }, []);
  return (
    <span role="status" className="sr-only">
      {ready && active ? t.common.loading : null}
    </span>
  );
}

export function LoadingStatus({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <>
      <LoadingAnnouncer />
      <div className={className} aria-hidden>
        {children}
      </div>
    </>
  );
}
