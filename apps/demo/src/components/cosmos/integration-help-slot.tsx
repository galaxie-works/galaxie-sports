import type { ClientAreaContext } from '@/components/client/client-area';
import type { HelpKind } from '@/lib/cosmos/integration-help';
import { helpAccess, helpMinimum } from '@/lib/cosmos/integration-tasks';

import { CosmosHelp } from './integration-help';

/**
 * Cartão da ajuda de integração (#1007) numa tela do painel: só aparece para quem pode usar (Admin ou Dono, com a
 * Cosmos contratada) e com a função ativa no catálogo. A equipe Galaxie não vê o aviso de custo (não gasta do tenant).
 */
export async function CosmosHelpSlot({
  ctx,
  kind,
  webhooks,
}: {
  ctx: ClientAreaContext;
  kind: HelpKind;
  webhooks?: { id: string; url: string }[];
}) {
  if (helpAccess(ctx)) return null;
  const min = await helpMinimum(kind);
  if (min === null) return null;
  return <CosmosHelp kind={kind} minCredits={ctx.role === 'admin' ? null : min} webhooks={webhooks} />;
}
