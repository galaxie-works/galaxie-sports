'use client';

import { MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { IconTile } from '@/components/reui/icon-tile';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { maskSecret } from './logic';

/** Estado da linha: configurada/no ar, faltando, vence logo, fora do ar ou neutro. */
export type StatusTone = 'ok' | 'missing' | 'warning' | 'offline' | 'neutral';

const TONE_VARIANT = {
  ok: 'success-light',
  missing: 'destructive-light',
  warning: 'warning-light',
  offline: 'destructive-light',
  neutral: 'secondary',
} as const;

export interface StatusMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface StatusItem {
  id: string;
  /** Conteúdo do `icon-tile` (ícone ou sigla). */
  icon: ReactNode;
  name: string;
  /** Para que serve (uma frase). */
  purpose?: ReactNode;
  /** Chaves e serviços em mono. */
  meta?: string;
  tone: StatusTone;
  statusLabel: string;
  /**
   * Dica do segredo: no máximo os 4 últimos caracteres, vindos do servidor. Nunca o valor; a linha mostra só
   * "•••• abcd" (`maskSecret`). Sem dica, nada aparece.
   */
  hint?: string | null;
  menu?: readonly StatusMenuItem[];
}

export interface StatusSection {
  id: string;
  title: string;
  description?: string;
  items: readonly StatusItem[];
}

/**
 * Lista de "configurado ou faltando" no desenho do bloco `settings-4` (#1076), com componentes gratuitos: seções com
 * título, uma linha por item com `icon-tile`, nome, para que serve, estado com ponto e `Badge`, e o menu ⋮.
 */
export function StatusList({
  title,
  description,
  action,
  sections,
  id,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  sections: readonly StatusSection[];
  id?: string;
}) {
  const { t } = useI18n();
  const B = t.ops.blocks.status;
  return (
    <Frame stacked id={id} className="scroll-mt-24">
      {title ? (
        <FrameHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>{title}</FrameTitle>
            {description ? <FrameDescription>{description}</FrameDescription> : null}
          </div>
          {action}
        </FrameHeader>
      ) : null}
      {sections.map((section) => (
        <FramePanel key={section.id} className="p-0" data-status-section={section.id}>
          <div className="flex flex-col gap-0.5 border-b px-4 py-3">
            <span className="text-sm font-semibold">{section.title}</span>
            {section.description ? (
              <span className="text-muted-foreground text-sm">{section.description}</span>
            ) : null}
          </div>
          <ul className="flex flex-col">
            {section.items.map((item) => (
              <li
                key={item.id}
                id={item.id}
                className="flex scroll-mt-24 flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <IconTile size="sm" aria-hidden="true" className="text-xs font-semibold">
                  {item.icon}
                </IconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{item.name}</span>
                  {item.purpose ? (
                    <span className="text-muted-foreground text-xs">{item.purpose}</span>
                  ) : null}
                  {item.meta ? (
                    <code className="text-muted-foreground font-mono text-xs break-all">{item.meta}</code>
                  ) : null}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {item.hint ? (
                    <span
                      className="text-muted-foreground font-mono text-xs"
                      title={fill(B.endsWith, { hint: maskSecret(item.hint).slice(-4) })}
                    >
                      {maskSecret(item.hint)}
                    </span>
                  ) : null}
                  <Badge variant={TONE_VARIANT[item.tone]} radius="full">
                    <span className="size-1.5 rounded-full bg-current" aria-hidden />
                    {item.statusLabel}
                  </Badge>
                  {item.menu?.length ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={fill(B.menu, { name: item.name })}
                          />
                        }
                      >
                        <MoreVertical />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        {item.menu.map((m) => (
                          <DropdownMenuItem key={m.label} disabled={m.disabled} onClick={m.onSelect}>
                            {m.icon}
                            {m.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </FramePanel>
      ))}
    </Frame>
  );
}
