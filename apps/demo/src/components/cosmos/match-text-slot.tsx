import { readClientContext } from '@/lib/client/session';
import type { MatchTextKind } from '@/lib/cosmos/match-text';
import { brandVoiceFor, matchTextAccess, matchTextMinimum } from '@/lib/cosmos/match-text-tasks';

import { MatchText } from './match-text';

/**
 * Lugar do "Texto para publicar" na página do jogo (#1009): só aparece para quem pode pedir (configurações do cliente
 * com a Cosmos contratada; a equipe Galaxie sempre) e com a função ativa no catálogo. Para os outros, nada.
 */
export async function MatchTextSlot({
  eventId,
  locale,
  kinds,
}: {
  eventId: string;
  locale: string;
  kinds: MatchTextKind[];
}) {
  if (!kinds.length) return null;
  const ctx = await readClientContext();
  if (!ctx?.tenant || matchTextAccess(ctx)) return null;
  let minimum: number | null;
  let saved: boolean;
  try {
    [minimum, { saved }] = await Promise.all([matchTextMinimum(), brandVoiceFor(ctx.tenant.id)]);
  } catch (err) {
    // a página do jogo não depende da Cosmos: banco fora ou tabela ainda sem migration somem com o card, não com a página
    console.error('[cosmos] texto do jogo indisponível', err);
    return null;
  }
  if (minimum === null) return null;
  return (
    <MatchText
      eventId={eventId}
      locale={locale}
      kinds={kinds}
      // a equipe Galaxie não gasta créditos do cliente: sem aviso de custo
      minCredits={ctx.role === 'admin' ? null : minimum}
      voiceSaved={saved}
    />
  );
}
