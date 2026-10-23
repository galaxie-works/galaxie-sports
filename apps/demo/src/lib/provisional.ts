/**
 * Jogo provisório (`event.provisional`): anunciado oficialmente e ainda não publicado pelo fornecedor de
 * dados. Sem horário confirmado, a API guarda o meio-dia no fuso do local: a tela mostra só a data.
 */
import type { Event } from '@galaxie/contracts';

import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { fill } from '@/lib/i18n/text';

type Provisional = NonNullable<Event['provisional']>;

/** O horário de início ainda não foi anunciado (só a data vale). */
export function timeToBeConfirmed(event: Pick<Event, 'provisional'>): boolean {
  return !!event.provisional && !event.provisional.time_confirmed;
}

/** Data e hora do card ("sáb., 28 de nov. de 2026, 16:00") ou, sem horário, a data e "horário a confirmar". */
export function kickoffText(
  event: Pick<Event, 'provisional' | 'starts_at'>,
  f: Formatters,
  t: Dictionary['sport'],
) {
  return timeToBeConfirmed(event)
    ? `${f.date(event.starts_at)} · ${t.provisional.timeTbc}`
    : f.dateTime(event.starts_at);
}

/** "Data e local anunciados pela Conmebol; horário a confirmar". */
export function announcementText(p: Provisional, t: Dictionary['sport']): string {
  const tx = t.provisional;
  if (p.announced_by) return fill(p.time_confirmed ? tx.announced : tx.announcedTbc, { by: p.announced_by });
  return p.time_confirmed ? tx.announcedAnon : tx.announcedTbcAnon;
}
