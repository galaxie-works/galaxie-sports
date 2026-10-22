'use client';

import type { Event } from '@galaxie/contracts';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { Crest } from '@/components/sport/crest';
import { EventCard } from '@/components/sport/event-card';
import { Section } from '@/components/sport/section';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/hooks/use-hydrated';
import {
  fetchLiveEvents,
  fetchUpcoming,
  LIVE_EVENTS_KEY,
  relevanceOf,
  UPCOMING_KEY,
} from '@/lib/galaxie/live';
import type { ApiRequest } from '@/lib/galaxie/request';
import { SPORTS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { RefreshTimer } from './refresh-timer';
import { useLiveRefresh } from './use-live-refresh';

interface CompetitionGroup {
  key: string;
  competition: Event['competition'];
  score: number;
  events: Event[];
}

interface SportGroup {
  sport: string;
  label: string;
  icon: (typeof SPORTS)[number]['icon'] | null;
  score: number;
  competitions: CompetitionGroup[];
}

const byRelevance = (a: Event, b: Event) =>
  relevanceOf(b) - relevanceOf(a) ||
  Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
  a.id.localeCompare(b.id);

/** Agrupa por esporte e competição; grupos e jogos em ordem de relevância (a maior primeiro). */
export function groupLive(events: Event[]): SportGroup[] {
  const sports = new Map<string, Map<string, CompetitionGroup>>();
  for (const e of events) {
    const comps = sports.get(e.sport) ?? new Map<string, CompetitionGroup>();
    const key = e.competition?.id ?? 'sem-competicao';
    const g = comps.get(key) ?? { key, competition: e.competition, score: 0, events: [] };
    g.events.push(e);
    g.score = Math.max(g.score, relevanceOf(e));
    comps.set(key, g);
    sports.set(e.sport, comps);
  }
  return [...sports.entries()]
    .map(([sport, comps]) => {
      const nav = SPORTS.find((s) => s.slug === sport);
      const competitions = [...comps.values()]
        .map((c) => ({ ...c, events: [...c.events].sort(byRelevance) }))
        .sort(
          (a, b) => b.score - a.score || (a.competition?.name ?? '').localeCompare(b.competition?.name ?? ''),
        );
      return {
        sport,
        label: nav?.label ?? sport,
        icon: nav?.icon ?? null,
        score: Math.max(...competitions.map((c) => c.score)),
        competitions,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Cartão que acende por alguns segundos quando o placar muda. */
function LiveCard({ event }: { event: Event }) {
  const score = `${event.score.home ?? '-'}:${event.score.away ?? '-'}`;
  const prev = useRef(score);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current === score) return;
    prev.current = score;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 4000);
    return () => clearTimeout(t);
  }, [score]);
  return (
    <div
      className={cn(
        'rounded-xl transition-shadow duration-700',
        flash && 'ring-primary shadow-primary/30 shadow-lg ring-2',
      )}
    >
      <EventCard event={event} />
    </div>
  );
}

function UpcomingKickoffs() {
  const { data, isLoading } = useQuery({
    queryKey: UPCOMING_KEY,
    queryFn: () => fetchUpcoming(6),
    staleTime: 60_000,
  });
  if (isLoading)
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  if (!data?.length) return null;
  return (
    <Section title="Próximos apitos" icon={<CalendarClock className="size-4" aria-hidden />}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
    </Section>
  );
}

/**
 * Página Ao vivo: tudo que está em andamento agora, por esporte e competição, com placar e relógio que
 * se atualizam sozinhos (SSE do /v1/stream + verificação periódica) e o contador da cadência no topo.
 */
export function LiveBoard({ api }: { api: ApiRequest }) {
  const q = useQuery({ queryKey: LIVE_EVENTS_KEY, queryFn: fetchLiveEvents, staleTime: 10_000 });
  const hydrated = useHydrated();
  const data = hydrated ? q.data : undefined;
  const events = useMemo(() => data ?? [], [data]);
  const refresh = useLiveRefresh({
    queryKey: LIVE_EVENTS_KEY,
    eventIds: events.map((e) => e.id),
    enabled: true,
    dataUpdatedAt: q.dataUpdatedAt,
    errorUpdatedAt: q.errorUpdatedAt,
  });
  const sourceLastAt = useMemo(() => {
    const times = events
      .map((e) => e.data_freshness.last_valid_at)
      .filter((x): x is string => !!x)
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    return times[0] ?? null;
  }, [events]);
  const groups = useMemo(() => groupLive(events), [events]);

  return (
    <div className="flex flex-col gap-6">
      <RefreshTimer state={refresh} sourceLastAt={sourceLastAt} className="sticky top-16 z-[5]" />

      {!hydrated || q.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : q.isError && !data ? (
        <EmptyState
          title="Não foi possível carregar os jogos ao vivo"
          description="A API não respondeu. A página tenta de novo sozinha."
        >
          <CircleAlert className="text-muted-foreground mx-auto size-5" aria-hidden />
        </EmptyState>
      ) : !events.length ? (
        <>
          <Section title="Jogos ao vivo" api={api}>
            <EmptyState
              title="Nenhum jogo ao vivo agora"
              description="Assim que um jogo começar, ele aparece aqui sozinho, com placar e relógio atualizados."
            />
          </Section>
          <UpcomingKickoffs />
        </>
      ) : (
        <Section
          title={`${events.length} ${events.length === 1 ? 'jogo ao vivo' : 'jogos ao vivo'}`}
          description="Por esporte e competição, do mais relevante para o menos relevante."
          api={api}
        >
          <div className="flex flex-col gap-8">
            {groups.map((g) => {
              const Icon = g.icon;
              return (
                <section key={g.sport} className="flex flex-col gap-4" aria-label={g.label}>
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    {Icon ? <Icon className="size-4" aria-hidden /> : null}
                    {g.label}
                    <span className="text-muted-foreground text-sm font-normal tabular-nums">
                      {g.competitions.reduce((n, c) => n + c.events.length, 0)}
                    </span>
                  </h3>
                  {g.competitions.map((c) => (
                    <div key={c.key} className="flex flex-col gap-2">
                      <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        {c.competition ? (
                          <Link
                            href={`/competicoes/${c.competition.slug}`}
                            className="text-foreground flex items-center gap-2 font-medium hover:underline"
                          >
                            <Crest src={c.competition.logo} name={c.competition.name} size="xs" />
                            {c.competition.name}
                          </Link>
                        ) : (
                          <span>Sem competição</span>
                        )}
                        <span className="tabular-nums">· {c.events.length}</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {c.events.map((e) => (
                          <LiveCard key={e.id} event={e} />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
