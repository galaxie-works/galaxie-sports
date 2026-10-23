'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * Grade que mostra só os `limit` primeiros itens e um botão para ver o resto: uma lista de 40
 * competições (estaduais, divisões de acesso) não empurra a Libertadores para a quinta tela do celular.
 * Os itens vêm prontos do servidor, na ordem de importância.
 */
export function ShowMore({
  items,
  limit = 6,
  className,
}: {
  items: React.ReactNode[];
  limit?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // esconder um item só não compensa: o botão ocupa o mesmo espaço
  const collapsible = items.length > limit + 1;
  const shown = collapsible && !open ? items.slice(0, limit) : items;
  return (
    <div className="flex flex-col gap-3">
      <div className={className}>{shown}</div>
      {collapsible ? (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          {open ? t.common.showLess : fill(t.common.showMore, { count: items.length - limit })}
        </Button>
      ) : null}
    </div>
  );
}
