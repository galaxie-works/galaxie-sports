'use client';

import Link from 'next/link';

import { useInExample } from '@/components/example/example-provider';
import { buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { authClient } from '@/lib/auth/client';
import { canAccessClientPanel } from '@/lib/auth/roles';
import { useI18n } from '@/lib/i18n/client';

import { CosmosIcon } from './cosmos-icon';

/**
 * Atalho da Cosmos AI no cabeçalho, à direita da lupa e separado dela por um traço vertical. Leva à
 * área da Cosmos no painel do cliente: some para quem não abre o painel e no exemplo público.
 */
export function CosmosHeaderButton() {
  const inExample = useInExample();
  const { data } = authClient.useSession();
  if (inExample || !canAccessClientPanel(data?.user.role)) return null;
  return <CosmosHeaderButtonInner />;
}

function CosmosHeaderButtonInner() {
  const T = useI18n().t.client.cosmos;
  return (
    <>
      <Separator orientation="vertical" className="data-vertical:h-4" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href="/cliente/cosmos"
              aria-label={T.button}
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            />
          }
        >
          <CosmosIcon aria-hidden className="size-5" />
        </TooltipTrigger>
        <TooltipContent>{T.button}</TooltipContent>
      </Tooltip>
    </>
  );
}
