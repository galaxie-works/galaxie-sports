import type { Event } from '@galaxie/contracts';

import { Badge } from '@/components/reui/badge';
import { getT } from '@/lib/i18n/server';

const LIVE = new Set(['starting', 'live', 'break']);
const PROBLEM = new Set(['postponed', 'cancelled', 'suspended', 'abandoned']);

export async function StatusBadge({ event }: { event: Pick<Event, 'status' | 'clock'> }) {
  const t = await getT();
  const label = t.sport.status[event.status] ?? event.status;
  if (LIVE.has(event.status)) {
    const minute = event.clock?.minute;
    return (
      <Badge variant="destructive-light" radius="full">
        <span className="bg-live size-1.5 animate-pulse rounded-full" aria-hidden />
        {minute ? `${minute}'` : label}
      </Badge>
    );
  }
  if (PROBLEM.has(event.status)) return <Badge variant="warning-light">{label}</Badge>;
  if (event.status === 'finished') return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}
