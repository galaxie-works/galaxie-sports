'use client';

import type { ReactNode } from 'react';

import { Badge } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import { IconTile } from '@/components/reui/icon-tile';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { useI18n } from '@/lib/i18n/client';

export type IntegrationState = 'connected' | 'disconnected' | 'attention';

const STATE_VARIANT = {
  connected: 'success-light',
  disconnected: 'secondary',
  attention: 'warning-light',
} as const;

/**
 * Cartão de integração no desenho do bloco `settings-6` (#1077), com componentes gratuitos: `icon-tile`, nome,
 * descrição e estado; à direita a ação (ir para Credenciais, configurar). Os ajustes (`children`) vêm logo abaixo,
 * em qualquer estado: quem chama trava o que não vale sem a integração (a âncora da chave nunca some). O cartão só
 * mostra o estado: nenhum segredo é gravado aqui.
 */
export function IntegrationCard({
  id,
  icon,
  name,
  description,
  state,
  action,
  children,
  setup,
}: {
  id?: string;
  icon: ReactNode;
  name: string;
  description?: ReactNode;
  state: IntegrationState;
  action?: ReactNode;
  /** Os ajustes da integração (sempre visíveis; desconectada, quem chama os trava). */
  children?: ReactNode;
  /** Sempre visível, depois dos ajustes (ex.: o formulário que liga a integração). */
  setup?: ReactNode;
}) {
  const { t } = useI18n();
  const B = t.ops.blocks.integrations;
  return (
    <Frame id={id} className="scroll-mt-24" data-integration-state={state}>
      <FramePanel className="flex flex-col gap-3">
        <Item className="p-0">
          <ItemMedia>
            <IconTile size="default" aria-hidden="true" className="text-xs font-semibold">
              {icon}
            </IconTile>
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="flex flex-wrap items-center gap-2">
              {name}
              <Badge variant={STATE_VARIANT[state]} radius="full">
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {B[state]}
              </Badge>
            </ItemTitle>
            {description ? <ItemDescription>{description}</ItemDescription> : null}
          </ItemContent>
          {action ? <ItemActions>{action}</ItemActions> : null}
        </Item>
        {children ? <div className="flex flex-col gap-2">{children}</div> : null}
        {setup}
      </FramePanel>
    </Frame>
  );
}

/** Um ajuste aninhado no cartão (fundo `muted`, como o bloco): título, descrição e o controle à direita. */
export function IntegrationOption({
  title,
  description,
  control,
}: {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <Item variant="muted">
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>{control}</ItemActions>
    </Item>
  );
}
