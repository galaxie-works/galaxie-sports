import type { Event } from '@galaxie/contracts';

import { getFormatters, getI18n } from '@/lib/i18n/server';

import { EventCardView } from './event-card-view';

/** Cartão de jogo nas páginas do servidor (idioma e fuso da requisição). */
export async function EventCard({
  event,
  showCompetition = true,
}: {
  event: Event;
  showCompetition?: boolean;
}) {
  const [{ locale, t }, f] = await Promise.all([getI18n(), getFormatters()]);
  return <EventCardView event={event} showCompetition={showCompetition} locale={locale} t={t.sport} f={f} />;
}
