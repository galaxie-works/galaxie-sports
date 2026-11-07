'use client';

/**
 * Envolve cada fallback de carregamento: anuncia "Carregando…" (no idioma da página) aos leitores de
 * tela uma vez só e esconde deles os blocos do esqueleto (`skeletons.tsx`), que não têm texto.
 *
 * O aviso fica num `<span>` à parte (`sr-only`, posicionado fora do fluxo), então não entra na grade nem
 * no `gap` de quem está em volta; `className` vai para o contêiner dos blocos.
 */
import { useI18n } from '@/lib/i18n/client';

export function LoadingStatus({ className, children }: { className?: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <span role="status" className="sr-only">
        {t.common.loading}
      </span>
      <div className={className} aria-hidden>
        {children}
      </div>
    </>
  );
}
