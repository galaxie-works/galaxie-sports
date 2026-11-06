'use client';

import {
  LIVE_LIST_FIELD_DEFAULTS,
  LIVE_LIST_LIMIT,
  LIVE_STATUSES,
  STARTED_STATUSES,
  isoDate,
  localTimeZone,
  sidesOf,
  type GsEvent,
  type GsEventList,
  type GsParticipant,
  type LiveListOptions,
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

export interface LiveListProps extends LiveListOptions {
  /** UUID ou slug da competição; sem ela, todas as competições do plano. */
  competitionId?: string | undefined;
  /** Esporte (ex.: football). */
  sport?: string | undefined;
  /** Dia AAAA-MM-DD; `live` = só os jogos ao vivo agora. Padrão: hoje no fuso do navegador. */
  date?: string | undefined;
}

const LIVE_REFRESH_MS = 30_000;
const DAY_REFRESH_MS = 120_000;

interface Group {
  key: string;
  name: string;
  logo: string | null;
  events: GsEvent[];
}

/**
 * Jogos do dia (ou só os ao vivo), agrupados por campeonato ou numa lista só, com polling enquanto houver
 * bola rolando. Cada linha pode mostrar rodada, estádio e cidade; o logo do campeonato vai no cabeçalho do
 * grupo (ou na linha, sem agrupar).
 */
export function LiveList({
  competitionId,
  sport,
  date,
  limit = LIVE_LIST_LIMIT.default,
  liveOnly: liveOnlyProp,
  groupByCompetition = true,
  autoRefresh = true,
  showCompetitionLogo = LIVE_LIST_FIELD_DEFAULTS.showCompetitionLogo,
  showRound = LIVE_LIST_FIELD_DEFAULTS.showRound,
  showVenue = LIVE_LIST_FIELD_DEFAULTS.showVenue,
  showCity = LIVE_LIST_FIELD_DEFAULTS.showCity,
}: LiveListProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const liveOnly = liveOnlyProp === true || date === 'live';
  const today = isoDate(new Date(), timeZone ?? localTimeZone());
  const day = liveOnly ? undefined : date && date !== 'live' ? date : today;
  const max = Math.min(
    Math.max(Math.trunc(limit) || LIVE_LIST_LIMIT.default, LIVE_LIST_LIMIT.min),
    LIVE_LIST_LIMIT.max,
  );
  const query = useGalaxieQuery<GsEventList>(
    liveOnly ? '/v1/events/live' : '/v1/events',
    liveOnly
      ? { competition: competitionId, sport }
      : { competition: competitionId, sport, date: day, limit: max },
    (list) =>
      !autoRefresh
        ? null
        : list.data.some((e) => LIVE_STATUSES.has(e.status) || e.status === 'starting')
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

  const events = query.data.data.slice(0, max);
  const single = Boolean(competitionId);
  const groups: Group[] = [];
  if (groupByCompetition) {
    const byKey = new Map<string, Group>();
    for (const event of events) {
      const key = single ? 'all' : (event.competition?.id ?? 'other');
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          name: event.competition?.name ?? '',
          logo: event.competition?.logo ?? null,
          events: [],
        };
        byKey.set(key, group);
        groups.push(group);
      }
      group.events.push(event);
    }
  } else {
    // um campeonato só: o nome e o logo ficam no cabeçalho, mesmo sem agrupar
    const competition = single ? events[0]?.competition : null;
    groups.push({ key: 'all', name: competition?.name ?? '', logo: competition?.logo ?? null, events });
  }

  return (
    <WidgetFrame kind="live_list">
      <h3 className="gs-title">{title}</h3>
      {events.length === 0 ? (
        <EmptyState>{liveOnly ? texts.emptyLive : texts.emptyDay}</EmptyState>
      ) : (
        groups.map((group) => {
          // a rodada igual para o grupo todo sobe para o cabeçalho, em vez de repetir em cada linha
          const rounds = new Set(group.events.map((e) => e.stage?.name ?? ''));
          const sharedRound = rounds.size === 1 ? [...rounds][0] || null : null;
          // vários campeonatos: cabeçalho por grupo; um só: o cabeçalho aparece para levar o logo (ou a rodada)
          const header = Boolean(
            group.name && (single ? showCompetitionLogo || (showRound && sharedRound) : groupByCompetition),
          );
          return (
            <div key={group.key} className="gs-group">
              {header ? (
                <div className="gs-group-title">
                  {showCompetitionLogo ? <Crest src={group.logo} name={group.name} size="xs" /> : null}
                  <span className="gs-truncate">
                    {showRound && sharedRound ? `${group.name} · ${sharedRound}` : group.name}
                  </span>
                </div>
              ) : null}
              <ul className="gs-list">
                {group.events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    time={fmt.time(event.starts_at)}
                    competition={!groupByCompetition && !single}
                    competitionLogo={showCompetitionLogo}
                    round={showRound && !(header && sharedRound)}
                    venue={showVenue}
                    city={showCity}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </WidgetFrame>
  );
}

function EventRow({
  event,
  time,
  competition,
  competitionLogo,
  round,
  venue,
  city,
}: {
  event: GsEvent;
  time: string;
  /** Nome do campeonato na linha (lista sem agrupar). */
  competition: boolean;
  competitionLogo: boolean;
  round: boolean;
  venue: boolean;
  city: boolean;
}) {
  const { home, away } = sidesOf(event);
  const started = STARTED_STATUSES.has(event.status);
  const showBadge = started || event.status !== 'scheduled';
  const place = [venue ? event.venue?.name : null, city ? event.venue?.city : null]
    .filter(Boolean)
    .join(', ');
  const comp = competition ? event.competition : null;
  const stage = round ? event.stage?.name : null;
  return (
    <li className="gs-row" data-gs-event={event.id}>
      <div className="gs-row-status">
        {showBadge ? <StatusBadge event={event} /> : <time dateTime={event.starts_at}>{time}</time>}
      </div>
      <div className="gs-row-teams">
        <Line p={home} goals={started ? event.score.home : null} />
        <Line p={away} goals={started ? event.score.away : null} />
        {comp || stage || place ? (
          <div className="gs-row-meta">
            {comp ? (
              <span data-gs-meta="competition">
                {competitionLogo ? <Crest src={comp.logo} name={comp.name} size="xs" /> : null}
                <span className="gs-truncate">{comp.name}</span>
              </span>
            ) : null}
            {stage ? <span data-gs-meta="round">{stage}</span> : null}
            {place ? <span data-gs-meta="venue">{place}</span> : null}
          </div>
        ) : null}
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
