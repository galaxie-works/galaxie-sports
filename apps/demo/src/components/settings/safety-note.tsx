'use client';

import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/** O risco da opção em uma frase, com o ícone de informação: vai no fim do detalhe da `SettingOption`. */
export function SafetyNote({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="note"
      aria-label={t.settings.safety.label}
      data-slot="safety-note"
      className={cn('text-muted-foreground flex items-start gap-2 text-xs', className)}
    >
      <Info aria-hidden className="mt-px size-3.5 shrink-0" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
