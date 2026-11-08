'use client';

import { Settings2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { SafetyNote } from './safety-note';

export interface SettingOptionProps {
  title: ReactNode;
  /** Nome em texto puro (rótulo da engrenagem quando `title` não é texto). */
  name?: string;
  description?: ReactNode;
  /** Opção de liga/desliga. Sem `onCheckedChange`, use `control` para um botão ou outro controle. */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Controle à direita no lugar do switch (botão, seletor). */
  control?: ReactNode;
  disabled?: boolean;
  /** "O que esta opção permite?": o detalhe aberto pela engrenagem. */
  allows?: ReactNode;
  /** Travas filhas: ficam desabilitadas enquanto a opção estiver desligada. */
  locks?: ReactNode;
  /** O risco em uma frase, no fim do detalhe. */
  safety?: ReactNode;
}

/**
 * Linha de opção das configurações: título, descrição, controle à direita (switch ou botão) e a
 * engrenagem que abre o detalhe ("O que esta opção permite?", travas e nota de segurança). Com o
 * recurso desligado, as travas ficam num `fieldset` desabilitado: nenhum controle filho muda.
 * Nada vem ligado por padrão: sem `checked`, o switch nasce desligado.
 */
export function SettingOption({
  title,
  name,
  description,
  checked = false,
  onCheckedChange,
  control,
  disabled,
  allows,
  locks,
  safety,
}: SettingOptionProps) {
  const { t } = useI18n();
  const T = t.settings.option;
  const titleId = useId();
  const descId = useId();
  const detailId = useId();
  const lockedId = useId();
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(allows || locks || safety);
  const isSwitch = onCheckedChange !== undefined;
  const locked = isSwitch && !checked;
  const label = name ?? (typeof title === 'string' ? title : '');

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="setting-option">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle id={titleId}>{title}</ItemTitle>
          {description ? <ItemDescription id={descId}>{description}</ItemDescription> : null}
        </ItemContent>
        <ItemActions>
          {isSwitch ? (
            <Switch
              checked={checked}
              onCheckedChange={(next) => onCheckedChange(next)}
              disabled={disabled}
              aria-labelledby={titleId}
              aria-describedby={description ? descId : undefined}
            />
          ) : (
            control
          )}
          {hasDetail ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={open}
              aria-controls={detailId}
              aria-label={fill(T.details, { name: label })}
              onClick={() => setOpen((o) => !o)}
            >
              <Settings2 aria-hidden />
            </Button>
          ) : null}
        </ItemActions>
      </Item>
      {hasDetail ? (
        <CollapsibleContent
          id={detailId}
          className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
        >
          <div className="flex flex-col gap-3 px-4 pt-3 pb-1">
            {allows ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{T.allows}</h3>
                <div className="text-muted-foreground text-sm">{allows}</div>
              </div>
            ) : null}
            {locks ? (
              <fieldset
                disabled={locked}
                aria-describedby={locked ? lockedId : undefined}
                className="flex flex-col gap-2 disabled:opacity-60"
              >
                <legend className="mb-1 text-sm font-medium">{T.locks}</legend>
                {locked ? (
                  <p id={lockedId} className="text-muted-foreground text-xs">
                    {T.lockedByParent}
                  </p>
                ) : null}
                {locks}
              </fieldset>
            ) : null}
            {safety ? <SafetyNote>{safety}</SafetyNote> : null}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
