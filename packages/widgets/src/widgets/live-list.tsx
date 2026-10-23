'use client';

import {
  LIVE_STATUSES,
  STARTED_STATUSES,
  isoDate,
  localTimeZone,
  sidesOf,
  type GsEvent,
  type GsEventList,
  type GsParticipant,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface LiveListProps {
  /** UUID ou slug da competição; sem ela, todas as competições do plano. */
  competitionId?: string | undefined;
  /** Esporte (ex.: football). */
  sport?: string | undefined;
  /** Dia AAAA-MM-DD; `live` = só os jogos ao vivo agora. Padrão: hoje no fuso do navegador. */
  date?: string | undefined;
  /** Máximo de jogos (padrão 30). */
  limit?: number | undefined;
}

const LIVE_REFRESH_MS = 30_000;
const DAY_REFRESH_MS = 120_000;

/** Jogos do dia (ou só os ao vivo), agrupados por competição, com polling enquanto houver bola rolando. */
export function LiveList({ competitionId, sport, date, limit = 30 }: LiveListProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const liveOnly = date === 'live';
  const today = isoDate(new Date(), timeZone ?? localTimeZone());
  const day = liveOnly ? undefined : (date ?? today);
  const query = useGalaxieQuery<GsEventList>(
    liveOnly ? '/v1/events/live' : '/v1/events',
    liveOnly
      ? { competition: competitionId, sport }
      : { competition: competitionId, sport, date: day, limit: Math.min(Math.max(limit, 1), 200) },
    (list) =>
      list.data.some((e) => LIVE_STATUSES.has(e.status) || e.status === 'starting')
        ? LIVE_REFRESH_MS
        : liveOnly || day === today
          ? DAY_REFRESH_MS
          : null,
  );
  const title = liveOnly ? texts.liveNow : texts.todayGames;

  if (!query.data) {
    return (
      <WidgetFrame kind="live_list" busy={query.loading}>
        <h3 className="gs-title">{title}</h3>
        {query.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const events = query.data.data.slice(0, limit);
  const groups = new Map<string, { name: string; logo: string | null; events: GsEvent[] }>();
  for (const event of events) {
    const key = competitionId ? 'all' : (event.competition?.id ?? 'other');
    const group = groups.get(key) ?? {
      name: competitionId ? '' : (event.competition?.name ?? ''),
      logo: event.competition?.logo ?? null,
      events: [],
    };
    group.events.push(event);
    groups.set(key, group);
  }

  return (
    <WidgetFrame kind="live_list">
      <h3 className="gs-title">{title}</h3>
      {events.length === 0 ? (
        <EmptyState>{liveOnly ? texts.emptyLive : texts.emptyDay}</EmptyState>
      ) : (
        [...groups.entries()].map(([key, group]) => (
          <div key={key} className="gs-group">
            {group.name ? (
              <div className="gs-group-title">
                <Crest src={group.logo} name={group.name} size="xs" />
                <span className="gs-truncate">{group.name}</span>
              </div>
            ) : null}
            <ul className="gs-list">
              {group.events.map((event) => (
                <EventRow key={event.id} event={event} time={fmt.time(event.starts_at)} />
              ))}
            </ul>
          </div>
        ))
      )}
    </WidgetFrame>
  );
}

function EventRow({ event, time }: { event: GsEvent; time: string }) {
  const { home, away } = sidesOf(event);
  const started = STARTED_STATUSES.has(event.status);
  const showBadge = started || event.status !== 'scheduled';
  return (
    <li className="gs-row" data-gs-event={event.id}>
      <div className="gs-row-status">
        {showBadge ? <StatusBadge event={event} /> : <time dateTime={event.starts_at}>{time}</time>}
      </div>
      <div className="gs-row-teams">
        <Line p={home} goals={started ? event.score.home : null} />
        <Line p={away} goals={started ? event.score.away : null} />
      </div>
    </li>
  );
}

function Line({ p, goals }: { p: GsParticipant | undefined; goals: number | null }) {
  if (!p) return null;
  return (
    <div className="gs-line" data-lost={p.winner === false || undefined}>
      <Crest src={p.logo} name={p.name} size="sm" />
      <span className="gs-truncate">{p.name}</span>
      {goals !== null ? <span className="gs-line-score">{goals}</span> : null}
    </div>
  );
}
