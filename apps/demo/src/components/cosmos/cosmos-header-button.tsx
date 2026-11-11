'use client';

import { useState } from 'react';

import { useInExample } from '@/components/example/example-provider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { authClient } from '@/lib/auth/client';
import { canAccessClientPanel } from '@/lib/auth/roles';
import { useI18n } from '@/lib/i18n/client';

import { CosmosAssistant } from './cosmos-assistant';
import { useCosmosAssistant } from './cosmos-assistant-provider';
import { CosmosIcon } from './cosmos-icon';

/**
 * Atalho da Cosmos AI no cabeçalho, à direita da lupa e separado dela por um traço vertical. Abre o assistente
 * (#1003) por cima da tela em que a pessoa está; o painel tem o link para os créditos. Some para quem não abre o
 * painel do cliente e no exemplo público.
 */
export function CosmosHeaderButton() {
  const inExample = useInExample();
  const { data } = authClient.useSession();
  if (inExample || !canAccessClientPanel(data?.user.role)) return null;
  return <CosmosHeaderButtonInner />;
}

function CosmosHeaderButtonInner() {
  const T = useI18n().t.cosmos.assistant;
  // na área logada o painel mora no layout (sobrevive à troca de tela); fora dela, o botão monta o próprio
  const shared = useCosmosAssistant();
  const [open, setOpen] = useState(false);
  // o painel só monta depois da primeira abertura: a conversa fica guardada ao fechar
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <Separator orientation="vertical" className="data-vertical:h-4" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={T.open}
              onClick={() => {
                if (shared) return shared.openAssistant();
                setMounted(true);
                setOpen(true);
              }}
            />
          }
        >
          <CosmosIcon aria-hidden className="size-5" />
        </TooltipTrigger>
        <TooltipContent>{T.title}</TooltipContent>
      </Tooltip>
      {!shared && mounted ? <CosmosAssistant open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
