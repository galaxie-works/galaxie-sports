import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Seção de uma página de configuração: título, uma frase e uma ação à direita, com os cartões embaixo.
 * A região leva o título como nome (`aria-labelledby`), para quem navega por regiões no leitor de tela.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-slot="settings-section"
      className={cn('flex flex-col gap-3', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {description ? <div className="text-muted-foreground text-sm">{description}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
