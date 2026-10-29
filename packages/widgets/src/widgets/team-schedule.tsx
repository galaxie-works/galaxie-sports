'use client';

import {
  LIVE_STATUSES,
  PROBLEM_STATUSES,
  STARTED_STATUSES,
  isoDate,
  localTimeZone,
  teamResult,
  type GsEvent,
  type GsEventList,
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

export interface TeamScheduleProps {
  /** Id do time na API Galaxie. */
  teamId: string;
  /** Quantos próximos jogos mostrar (padrão 3). */
  next?: number | undefined;
  /** Quantos resultados recentes mostrar (padrão 3; 0 esconde). */
  recent?: number | undefined;
}

const DAY_MS = 24 * 60 * 60_000;
/** Janela da agenda: 45 dias para trás (resultados) e 60 para a frente (próximos jogos). */
const PAST_DAYS = 45;
const AHEAD_DAYS = 60;
const LIVE_REFRESH_MS = 30_000;
const SCHEDULE_REFRESH_MS = 15 * 60_000;

/** Agenda do time: os próximos jogos (com o ao vivo no topo) e os últimos resultados, com V/E/D. */
export function TeamSchedule({ teamId, next = 3, recent = 3 }: TeamScheduleProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.schedule;
  const tz = timeZone ?? localTimeZone();
  const now = Date.now();
  const query = useGalaxieQuery<GsEventList>(
    teamId ? `/v1/teams/${encodeURIComponent(teamId)}/events` : null,
    {
      from: isoDate(new Date(now - PAST_DAYS * DAY_MS), tz),
      to: isoDate(new Date(now + AHEAD_DAYS * DAY_MS), tz),
      limit: 100,
    },
    (list) =>
      list.data.some((e) => LIVE_STATUSES.has(e.status) || e.status === 'starting')
        ? LIVE_REFRESH_MS
        : SCHEDULE_REFRESH_MS,
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="team_schedule" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const events = [...query.data.data].sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
  const upcoming = events
    .filter((e) => !STARTED_STATUSES.has(e.status) || LIVE_STATUSES.has(e.status))
    .filter((e) => e.status !== 'cancelled')
    .slice(0, Math.max(0, next));
  const results = events
    .filter((e) => e.status === 'finished')
    .reverse()
    .slice(0, Math.max(0, recent));
  const team = events.flatMap((e) => e.participants).find((p) => p.id === teamId);

  return (
    <WidgetFrame kind="team_schedule">
      <header className="gs-header">
        {team ? <Crest src={team.logo} name={team.name} size="sm" /> : null}
        <h3 className="gs-title gs-truncate">{team ? team.name : t.title}</h3>
      </header>
      {upcoming.length === 0 && results.length === 0 ? <EmptyState>{t.empty}</EmptyState> : null}
      {upcoming.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.next}</div>
          <ul className="gs-list">
            {upcoming.map((e) => (
              <Fixture
                key={e.id}
                event={e}
                teamId={teamId}
                date={fmt.dayMonth(e.starts_at)}
                time={fmt.time(e.starts_at)}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {results.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.recent}</div>
          <ul className="gs-list">
            {results.map((e) => (
              <Fixture key={e.id} event={e} teamId={teamId} date={fmt.date(e.starts_at)} />
            ))}
          </ul>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function Fixture({
  event,
  teamId,
  date,
  time,
}: {
  event: GsEvent;
  teamId: string;
  date: string;
  time?: string | undefined;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.schedule;
  const me = event.participants.find((p) => p.id === teamId);
  const rival = event.participants.find((p) => p.id !== teamId);
  if (!rival) return null;
  const home = me ? me.side === 'home' : true;
  const result = teamResult(event, teamId);
  const started = STARTED_STATUSES.has(event.status);
  const mine = home ? event.score.home : event.score.away;
  const theirs = home ? event.score.away : event.score.home;
  return (
    <li className="gs-fixture" data-gs-event={event.id}>
      <time className="gs-fixture-date" dateTime={event.starts_at}>
        {date}
        {time && !started ? ` · ${time}` : null}
      </time>
      <span className="gs-line gs-grow">
        <Crest src={rival.logo} name={rival.name} size="xs" />
        <span className="gs-truncate">{rival.short_name ?? rival.name}</span>
        <span className="gs-muted gs-small">{home ? t.home : t.away}</span>
      </span>
      {started && mine !== null && theirs !== null ? (
        <span className="gs-line-score">
          {mine} – {theirs}
        </span>
      ) : null}
      {result ? (
        <span className="gs-result" data-r={result}>
          {t.result[result]}
        </span>
      ) : LIVE_STATUSES.has(event.status) || PROBLEM_STATUSES.has(event.status) ? (
        <StatusBadge event={event} />
      ) : null}
    </li>
  );
}
