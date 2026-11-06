'use client';

import {
  LIVE_STATUSES,
  PROBLEM_STATUSES,
  STARTED_STATUSES,
  fillText,
  isoDate,
  localTimeZone,
  teamResult,
  type GsEvent,
  type GsEventList,
  type GsTeamOverview,
} from '../core/model.js';
import {
  CalendarButton,
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
  /** UUID ou slug de um campeonato: só os jogos dele. */
  competitionId?: string | undefined;
  /** Logo do campeonato em cada jogo (padrão: não). */
  showCompetitionLogo?: boolean | undefined;
  /** Rodada ou fase de cada jogo (padrão: não). */
  showRound?: boolean | undefined;
  /** Estádio de cada jogo (padrão: não). */
  showVenue?: boolean | undefined;
  /** Cidade do estádio (padrão: não). */
  showCity?: boolean | undefined;
  /** Posição na tabela e forma recente no cabeçalho (padrão: não). */
  showStanding?: boolean | undefined;
  /** Botão "adicionar ao calendário" nos próximos jogos (padrão: não). */
  showCalendar?: boolean | undefined;
}

interface FixtureMeta {
  competitionLogo: boolean;
  round: boolean;
  venue: boolean;
  city: boolean;
  calendar: boolean;
}

const DAY_MS = 24 * 60 * 60_000;
/** Janela da agenda: 45 dias para trás (resultados) e 60 para a frente (próximos jogos). */
const PAST_DAYS = 45;
const AHEAD_DAYS = 60;
const LIVE_REFRESH_MS = 30_000;
const SCHEDULE_REFRESH_MS = 15 * 60_000;

/** Agenda do time: os próximos jogos (com o ao vivo no topo) e os últimos resultados, com V/E/D. */
export function TeamSchedule({
  teamId,
  next = 3,
  recent = 3,
  competitionId,
  showCompetitionLogo = false,
  showRound = false,
  showVenue = false,
  showCity = false,
  showStanding = false,
  showCalendar = false,
}: TeamScheduleProps) {
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
      competition: competitionId,
    },
    (list) =>
      list.data.some((e) => LIVE_STATUSES.has(e.status) || e.status === 'starting')
        ? LIVE_REFRESH_MS
        : SCHEDULE_REFRESH_MS,
  );

  const overview = useGalaxieQuery<GsTeamOverview>(
    teamId && showStanding ? `/v1/teams/${encodeURIComponent(teamId)}/overview` : null,
    {},
    () => SCHEDULE_REFRESH_MS,
  );
  const meta: FixtureMeta = {
    competitionLogo: showCompetitionLogo,
    round: showRound,
    venue: showVenue,
    city: showCity,
    calendar: showCalendar,
  };

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
        {showStanding && overview.data ? (
          <Standing overview={overview.data} competitionId={competitionId} />
        ) : null}
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
                meta={meta}
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
              <Fixture
                key={e.id}
                event={e}
                teamId={teamId}
                date={fmt.date(e.starts_at)}
                meta={{ ...meta, calendar: false }}
              />
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
  meta,
}: {
  event: GsEvent;
  teamId: string;
  date: string;
  time?: string | undefined;
  meta: FixtureMeta;
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
  const place = [meta.venue ? event.venue?.name : null, meta.city ? event.venue?.city : null].filter(Boolean);
  const details = [meta.round ? event.stage?.name : null, place.join(', ')].filter(Boolean) as string[];
  return (
    <li className="gs-fixture" data-gs-event={event.id}>
      <time className="gs-fixture-date" dateTime={event.starts_at}>
        {date}
        {time && !started ? ` · ${time}` : null}
      </time>
      <span className="gs-grow" style={{ minWidth: 0 }}>
        <span className="gs-line">
          <Crest src={rival.logo} name={rival.name} size="xs" />
          <span className="gs-truncate">{rival.short_name ?? rival.name}</span>
          <span className="gs-muted gs-small">{home ? t.home : t.away}</span>
        </span>
        {details.length || (meta.competitionLogo && event.competition) ? (
          <span className="gs-line gs-meta">
            {meta.competitionLogo && event.competition ? (
              <Crest src={event.competition.logo} name={event.competition.name} size="xs" />
            ) : null}
            {details.length ? <span className="gs-truncate">{details.join(' · ')}</span> : null}
          </span>
        ) : null}
      </span>
      {meta.calendar ? <CalendarButton event={event} compact /> : null}
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

/** Posição na tabela (do campeonato filtrado, ou o primeiro) e a forma dos últimos 5, no cabeçalho. */
function Standing({
  overview,
  competitionId,
}: {
  overview: GsTeamOverview;
  competitionId: string | undefined;
}) {
  const { texts } = useGalaxieWidget();
  const standing =
    overview.standings.find((s) => competitionId && s.competition.id === competitionId) ??
    overview.standings[0];
  const form = [...overview.form].reverse().slice(-5);
  return (
    <span className="gs-line gs-small" style={{ marginLeft: 'auto' }}>
      {standing && standing.rank ? (
        <span className="gs-muted gs-truncate">
          {fillText(texts.extra.position, { rank: standing.rank, competition: standing.competition.name })}
        </span>
      ) : null}
      {form.length ? (
        <span className="gs-form" aria-label={texts.extra.form}>
          {form.map((f) => (
            <span key={f.event_id} className="gs-result" data-r={f.result}>
              {texts.schedule.result[f.result]}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
