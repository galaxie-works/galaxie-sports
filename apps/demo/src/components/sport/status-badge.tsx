import type { Event } from '@galaxie/contracts';

import { getT } from '@/lib/i18n/server';

import { StatusBadgeView } from './event-card-view';

export async function StatusBadge({
  event,
}: {
  event: Pick<Event, 'status' | 'clock'> & { score?: Pick<Event['score'], 'home' | 'away'> };
}) {
  return <StatusBadgeView event={event} t={(await getT()).sport} />;
}
