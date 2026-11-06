'use client';

import {
  LIVE_STATUSES,
  STARTED_STATUSES,
  eventRefreshMs,
  fillText,
  intlLocale,
  localTimeZone,
  sidesOf,
  venueTimeText,
  type GsEvent,
  type GsEventStats,
  type GsLineups,
  type GsTimeline,
  type GsTimelineIncident,
} from '../core/model.js';
import {
  CalendarButton,
  Crest,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface MatchCardProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /** Nome do campeonato no topo (padrão: sim). */
  showCompetition?: boolean | undefined;
  /** Logo do campeonato no topo (padrão: sim). */
  showCompetitionLogo?: boolean | undefined;
  /** País do campeonato, com a bandeira (padrão: não). */
  showCountry?: boolean | undefined;
  /** Rodada ou fase ("Rodada 32", "Semifinal · Volta") (padrão: sim). */
  showRound?: boolean | undefined;
  /** Estádio no rodapé (padrão: sim). */
  showVenue?: boolean | undefined;
  /** Cidade do estádio no rodapé (padrão: sim). */
  showCity?: boolean | undefined;
  /** Árbitro principal (padrão: não). */
  showReferee?: boolean | undefined;
  /** Placar do 1º tempo (padrão: não). */
  showHalftime?: boolean | undefined;
  /** Placar agregado no jogo de volta (padrão: não). */
  showAggregate?: boolean | undefined;
  /** Parciais por set ou quarto nos outros esportes (padrão: não). */
  showPeriods?: boolean | undefined;
  /** Hora local do jogo quando o estádio está em outro fuso (padrão: não). */
  venueTime?: boolean | undefined;
  /** Gols com autor e minuto (minuto a minuto; padrão: não). */
  showGoals?: boolean | undefined;
  /** Cartões vermelhos (minuto a minuto; padrão: não). */
  showRedCards?: boolean | undefined;
  /** Posse, finalizações e no alvo (padrão: não). */
  showStats?: boolean | undefined;
  /** Formação tática de cada time (padrão: não). */
  showFormation?: boolean | undefined;
  /** Botão "adicionar ao calendário" antes do jogo (padrão: não). */
  showCalendar?: boolean | undefined;
}

const GOAL_KINDS = new Set(['goal', 'own_goal', 'penalty_goal']);
const RED_KINDS = new Set(['red_card', 'second_yellow']);
const STAT_CODES = ['possession_pct', 'shots_total', 'shots_on_goal'] as const;
/** Lances e estatísticas mudam só com o jogo rolando: 1 minuto ao vivo, parado depois. */
const DETAIL_LIVE_MS = 60_000;

const enc = encodeURIComponent;

/** Placar de um jogo: escudos, placar, minuto ao vivo, competição e horário local. */
export function MatchCard({
  eventId,
  showCompetition = true,
  showCompetitionLogo = true,
  showCountry = false,
  showRound = true,
  showVenue = true,
  showCity = true,
  showReferee = false,
  showHalftime = false,
  showAggregate = false,
  showPeriods = false,
  venueTime = false,
  showGoals = false,
  showRedCards = false,
  showStats = false,
  showFormation = false,
  showCalendar = false,
}: MatchCardProps) {
  const { texts, locale, market, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const query = useGalaxieQuery<GsEvent>(eventId ? `/v1/events/${enc(eventId)}` : null, {}, (event) =>
    eventRefreshMs(event),
  );
  const event = query.data;
  const started = event ? STARTED_STATUSES.has(event.status) : false;
  const live = event ? LIVE_STATUSES.has(event.status) : false;
  const detailMs = () => (live ? DETAIL_LIVE_MS : null);
  const timeline = useGalaxieQuery<GsTimeline>(
    event && started && (showGoals || showRedCards) ? `/v1/events/${enc(event.id)}/timeline` : null,
    {},
    detailMs,
  );
  const stats = useGalaxieQuery<GsEventStats>(
    event && started && showStats ? `/v1/events/${enc(event.id)}/stats` : null,
    {},
    detailMs,
  );
  const lineups = useGalaxieQuery<GsLineups>(
    event && showFormation ? `/v1/events/${enc(event.id)}/lineups` : null,
    {},
    detailMs,
  );
  if (!event) {
    return (
      <WidgetFrame kind="match_card" busy={query.loading}>
        {query.loading ? (
          <LoadingState lines={3} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const { home, away } = sidesOf(event);
  const { score } = event;
  const hasScore = score.home !== null || score.away !== null;
  const penalty = score.penalty && score.penalty.home !== null ? score.penalty : null;
  const ht = showHalftime && started && score.halftime?.home != null ? score.halftime : null;
  const agg = showAggregate && score.aggregate?.home != null ? score.aggregate : null;
  const periods = showPeriods && started ? (score.periods ?? []).filter((p) => p.home !== null) : [];
  const competition = event.competition;
  const title = [
    showCompetition ? competition?.name : null,
    showCountry && competition?.country && competition.country.code !== 'WORLD'
      ? competition.country.name
      : null,
    showRound ? event.stage?.name : null,
  ].filter(Boolean);
  const place = [showVenue ? event.venue?.name : null, showCity ? event.venue?.city : null].filter(Boolean);
  const localTime = venueTime
    ? venueTimeText(event, intlLocale(locale, market), timeZone ?? localTimeZone())
    : null;
  const incidents = (timeline.data?.incidents ?? []).filter(
    (i) => (showGoals && GOAL_KINDS.has(i.kind)) || (showRedCards && RED_KINDS.has(i.kind)),
  );
  const formations = showFormation
    ? [home, away].map(
        (p) =>
          lineups.data?.lineups.find((x) => x.team.id === p?.id || x.team.side === p?.side)?.formation ??
          null,
      )
    : [];
  const statRows = showStats ? statLines(stats.data, home?.id, away?.id, texts.extra) : [];
  return (
    <WidgetFrame kind="match_card">
      <header className="gs-header">
        {competition && showCompetitionLogo ? (
          <Crest src={competition.logo} name={competition.name} size="sm" />
        ) : null}
        {showCountry && competition?.country?.flag ? (
          <Crest src={competition.country.flag} name={competition.country.name} size="xs" />
        ) : null}
        <span className="gs-truncate">{title.join(' · ')}</span>
        <span className="gs-spacer" />
        <StatusBadge event={event} />
      </header>
      <div className="gs-match">
        <div className="gs-team" data-lost={home?.winner === false || undefined}>
          <Crest src={home?.logo} name={home?.name ?? '?'} />
          <span>{home?.short_name ?? home?.name}</span>
          {formations[0] ? <span className="gs-meta">{formations[0]}</span> : null}
        </div>
        {started && hasScore ? (
          <div className="gs-score" data-live={live || undefined} aria-live={live ? 'polite' : undefined}>
            <span>
              {score.home ?? 0} – {score.away ?? 0}
            </span>
            {penalty ? (
              <small>
                ({penalty.home} – {penalty.away} {texts.penalties})
              </small>
            ) : null}
            {ht ? (
              <small>{fillText(texts.extra.halftime, { home: ht.home ?? 0, away: ht.away ?? 0 })}</small>
            ) : null}
            {agg ? (
              <small>{fillText(texts.extra.aggregate, { home: agg.home ?? 0, away: agg.away ?? 0 })}</small>
            ) : null}
          </div>
        ) : (
          <span className="gs-versus">
            {texts.versus}
            {agg ? (
              <small className="gs-meta">
                {fillText(texts.extra.aggregate, { home: agg.home ?? 0, away: agg.away ?? 0 })}
              </small>
            ) : null}
          </span>
        )}
        <div className="gs-team" data-lost={away?.winner === false || undefined}>
          <Crest src={away?.logo} name={away?.name ?? '?'} />
          <span>{away?.short_name ?? away?.name}</span>
          {formations[1] ? <span className="gs-meta">{formations[1]}</span> : null}
        </div>
      </div>
      {periods.length || incidents.length || statRows.length ? (
        <div className="gs-extras">
          {periods.length ? (
            <div className="gs-meta" data-gs-periods="">
              {periods.map((p) => `${p.home ?? 0}–${p.away ?? 0}`).join(' · ')}
            </div>
          ) : null}
          {incidents.length ? (
            <ul className="gs-incidents">
              {incidents.map((i) => (
                <Incident key={i.sequence} incident={i} homeId={home?.id} texts={texts.extra} />
              ))}
            </ul>
          ) : null}
          {statRows.map((row) => (
            <div key={row.label} className="gs-statrow">
              <span>{row.home}</span>
              <span>{row.label}</span>
              <span>{row.away}</span>
            </div>
          ))}
        </div>
      ) : null}
      <footer className="gs-footer">
        <time dateTime={event.starts_at}>
          {fmt.dateTime(event.starts_at)}
          {localTime ? ` · ${fillText(texts.extra.venueTime, { time: localTime })}` : null}
        </time>
        {place.length ? <span className="gs-truncate">{place.join(', ')}</span> : null}
        {showReferee && event.referee?.name ? (
          <span className="gs-truncate">{`${texts.extra.referee}: ${event.referee.name}`}</span>
        ) : null}
        {showCalendar ? <CalendarButton event={event} /> : null}
      </footer>
    </WidgetFrame>
  );
}

/** Lado do lance: no gol, o time que somou (gol contra conta para o adversário). */
function incidentSide(i: GsTimelineIncident, homeId: string | undefined): 'home' | 'away' {
  const team = GOAL_KINDS.has(i.kind) ? (i.scoring_team ?? i.team) : i.team;
  if (team?.side === 'home' || team?.side === 'away') return team.side;
  return team?.id && team.id === homeId ? 'home' : 'away';
}

function Incident({
  incident: i,
  homeId,
  texts,
}: {
  incident: GsTimelineIncident;
  homeId: string | undefined;
  texts: { ownGoal: string; penalty: string };
}) {
  const minute = i.minute === null ? '' : `${i.minute}${i.extra ? `+${i.extra}` : ''}'`;
  const note =
    i.kind === 'own_goal' ? ` (${texts.ownGoal})` : i.kind === 'penalty_goal' ? ` (${texts.penalty})` : '';
  return (
    <li data-side={incidentSide(i, homeId)} data-kind={i.kind}>
      {RED_KINDS.has(i.kind) ? <span className="gs-card-red" aria-hidden /> : null}
      {`${i.player?.name ?? '?'}${note} ${minute}`.trim()}
    </li>
  );
}

function statLines(
  data: GsEventStats | null,
  homeId: string | undefined,
  awayId: string | undefined,
  texts: { possession: string; shots: string; onTarget: string },
) {
  if (!data?.available || data.teams.length < 2) return [];
  const teamOf = (id: string | undefined, side: string) =>
    data.teams.find((t) => (id && t.team.id === id) || t.team.side === side);
  const h = teamOf(homeId, 'home');
  const a = teamOf(awayId, 'away');
  if (!h || !a) return [];
  const value = (t: (typeof data.teams)[number], code: string) => {
    const v = t.statistics.find((s) => s.code === code)?.value;
    return v === null || v === undefined ? null : String(v);
  };
  const labels: Record<(typeof STAT_CODES)[number], string> = {
    possession_pct: texts.possession,
    shots_total: texts.shots,
    shots_on_goal: texts.onTarget,
  };
  return STAT_CODES.flatMap((code) => {
    const home = value(h, code);
    const away = value(a, code);
    if (home === null && away === null) return [];
    const pct = (v: string | null) =>
      v === null ? '–' : code === 'possession_pct' && !v.endsWith('%') ? `${v}%` : v;
    return [{ label: labels[code], home: pct(home), away: pct(away) }];
  });
}
