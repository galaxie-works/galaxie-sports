import type { Event } from '@galaxie/contracts';
import { Flame } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Card } from '@/components/ui/card';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Crest } from './crest';
import { StatusBadge } from './status-badge';

const STARTED = new Set(['live', 'break', 'finished', 'suspended', 'abandoned']);

function TeamRow({
  p,
  goals,
  started,
}: {
  p: Event['participants'][number];
  goals: number | null;
  started: boolean;
}) {
  const lost = p.winner === false;
  return (
    <div className="flex items-center gap-2">
      <Crest src={p.logo} name={p.name} size="xs" />
      <span className={cn('flex-1 truncate text-sm', lost && 'text-muted-foreground')}>{p.name}</span>
      {started ? (
        <span
          className={cn('w-5 text-right text-sm font-semibold tabular-nums', lost && 'text-muted-foreground')}
        >
          {goals ?? '–'}
        </span>
      ) : null}
    </div>
  );
}

/** Cartão de partida clicável: competição/rodada, times com escudo, placar ou horário, clássico. */
export function EventCard({ event, showCompetition = true }: { event: Event; showCompetition?: boolean }) {
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  const started = STARTED.has(event.status);

  return (
    <Link href={`/eventos/${event.id}`} className="group/event focus-visible:outline-none">
      <Card size="sm" className="group-hover/event:bg-accent h-full gap-2 transition-colors">
        <div className="text-muted-foreground flex items-center gap-2 px-3 text-xs">
          {showCompetition && event.competition ? (
            <>
              <Crest src={event.competition.logo} name={event.competition.name} size="xs" />
              <span className="truncate">{event.competition.nickname ?? event.competition.name}</span>
              {event.stage?.name ? <span aria-hidden>·</span> : null}
            </>
          ) : null}
          {event.stage?.name ? <span className="truncate">{event.stage.name}</span> : null}
          <span className="ml-auto shrink-0">
            <StatusBadge event={event} />
          </span>
        </div>
        <div className="flex flex-col gap-1.5 px-3">
          {home ? <TeamRow p={home} goals={event.score.home} started={started} /> : null}
          {away ? <TeamRow p={away} goals={event.score.away} started={started} /> : null}
        </div>
        <div className="text-muted-foreground flex items-center gap-2 px-3 text-xs">
          <span>{fmtDateTime(event.starts_at)}</span>
          {event.derby ? (
            <Badge variant="warning-light" radius="full" className="ml-auto">
              <Flame aria-hidden />
              {event.derby.name}
            </Badge>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}
