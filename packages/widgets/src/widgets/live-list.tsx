'use client';

import {
  LIVE_LIST_FIELD_DEFAULTS,
  LIVE_LIST_LIMIT,
  LIVE_STATUSES,
  STARTED_STATUSES,
  apiLocale,
  eventLinkFor,
  isEventLinkTemplate,
  isoDate,
  localized,
  localTimeZone,
  sidesOf,
  type GsEvent,
  type GsEventList,
  type GsParticipant,
  type LiveListDay,
  type LiveListMode,
  type LiveListOptions,
  type WidgetTexts,
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
  /** UUID do time: só os jogos dele. */
  teamId?: string | undefined;
  /** Esporte (ex.: football). */
  sport?: string | undefined;
  /** Dia AAAA-MM-DD; `live` = só os jogos ao vivo agora. Tem precedência sobre `day`. */
  date?: string | undefined;
  /** @deprecated use `mode="live"`. */
  liveOnly?: boolean | undefined;
}

const LIVE_REFRESH_MS = 30_000;
const DAY_REFRESH_MS = 120_000;
const DAY_MS = 86_400_000;
const STATUS_BY_MODE: Partial<Record<LiveListMode, string>> = {
  upcoming: 'scheduled,starting',
  finished: 'finished',
};

interface Group {
  key: string;
  name: string;
  logo: string | null;
  events: GsEvent[];
}

const relevanceOf = (e: GsEvent) => e.relevance?.score ?? e.importance ?? 0;

/**
 * Jogos de um dia (ou só os ao vivo, os próximos ou os encerrados), agrupados por campeonato ou numa lista
 * só, com polling enquanto houver bola rolando. Recortes: campeonato, time, país e relevância no país. Cada
 * linha pode mostrar rodada, estádio, cidade, árbitro, selo de clássico, o que está em jogo e o link do
 * jogo no site do cliente.
 */
export function LiveList({
  competitionId,
  teamId,
  sport,
  date,
  limit = LIVE_LIST_LIMIT.default,
  liveOnly: liveOnlyProp,
  mode: modeProp,
  day: dayProp = 'today',
  order = 'time',
  minRelevance,
  country,
  teamName = 'full',
  eventLink,
  eventLinkNewTab = false,
  groupByCompetition = true,
  autoRefresh = true,
  showCompetitionLogo = LIVE_LIST_FIELD_DEFAULTS.showCompetitionLogo,
  showRound = LIVE_LIST_FIELD_DEFAULTS.showRound,
  showVenue = LIVE_LIST_FIELD_DEFAULTS.showVenue,
  showCity = LIVE_LIST_FIELD_DEFAULTS.showCity,
  showDerby = LIVE_LIST_FIELD_DEFAULTS.showDerby,
  showStakes = LIVE_LIST_FIELD_DEFAULTS.showStakes,
  showReferee = LIVE_LIST_FIELD_DEFAULTS.showReferee,
  showPenalties = LIVE_LIST_FIELD_DEFAULTS.showPenalties,
}: LiveListProps) {
  const { texts, timeZone, locale, market } = useGalaxieWidget();
  const fmt = useFormatters();
  const mode: LiveListMode = date === 'live' || liveOnlyProp === true ? 'live' : (modeProp ?? 'all');
  const liveOnly = mode === 'live';
  const tz = timeZone ?? localTimeZone();
  const now = Date.now();
  const today = isoDate(new Date(now), tz);
  const shift = dayProp === 'tomorrow' ? 1 : dayProp === 'yesterday' ? -1 : 0;
  const day = liveOnly
    ? undefined
    : date && date !== 'live'
      ? date
      : isoDate(new Date(now + shift * DAY_MS), tz);
  const max = Math.min(
    Math.max(Math.trunc(limit) || LIVE_LIST_LIMIT.default, LIVE_LIST_LIMIT.min),
    LIVE_LIST_LIMIT.max,
  );
  const byRelevance = order === 'relevance';
  const link = isEventLinkTemplate(eventLink) ? eventLink : null;
  const query = useGalaxieQuery<GsEventList>(
    liveOnly ? '/v1/events/live' : '/v1/events',
    liveOnly
      ? { competition: competitionId, sport, country, market }
      : {
          competition: competitionId,
          team: teamId,
          sport,
          country,
          market,
          date: day,
          status: STATUS_BY_MODE[mode],
          order: byRelevance ? 'relevance' : undefined,
          relevance_min: minRelevance || undefined,
          limit: max,
        },
    (list) =>
      !autoRefresh
        ? null
        : list.data.some((e) => LIVE_STATUSES.has(e.status) || e.status === 'starting')
          ? LIVE_REFRESH_MS
          : liveOnly || day === today
            ? DAY_REFRESH_MS
            : null,
  );
  const title = titleFor(
    texts,
    mode,
    day === today ? 'today' : day && day > today ? 'tomorrow' : 'yesterday',
  );

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

  let events = query.data.data;
  if (liveOnly) {
    // a rota ao vivo não filtra por time nem por relevância: o recorte é feito aqui
    if (teamId) events = events.filter((e) => e.participants.some((p) => p.id === teamId));
    if (minRelevance) events = events.filter((e) => relevanceOf(e) >= minRelevance);
    if (byRelevance) events = [...events].sort((a, b) => relevanceOf(b) - relevanceOf(a));
  }
  events = events.slice(0, max);
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
  const lang = apiLocale(locale, market);
  const row = {
    competitionLogo: showCompetitionLogo,
    venue: showVenue,
    city: showCity,
    derby: showDerby,
    stakes: showStakes,
    referee: showReferee,
    penalties: showPenalties,
    shortNames: teamName === 'short',
    link,
    newTab: eventLinkNewTab,
    lang,
  };

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
                    round={showRound && !(header && sharedRound)}
                    refereeLabel={texts.referee}
                    {...row}
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

function titleFor(texts: WidgetTexts, mode: LiveListMode, day: LiveListDay): string {
  if (mode === 'live') return texts.liveNow;
  if (mode === 'finished') return day === 'yesterday' ? texts.yesterdayResults : texts.todayResults;
  if (day === 'tomorrow') return texts.tomorrowGames;
  if (day === 'yesterday') return texts.yesterdayGames;
  return mode === 'upcoming' ? texts.upcomingGames : texts.todayGames;
}

/** O que está em jogo para cada lado: a tag mais forte do torcedor ou, sem ela, o stake saliente. */
function stakeTags(event: GsEvent, lang: string | undefined): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const stakes = event.stakes ?? [];
  for (const p of event.participants) {
    const tag = [...(p.fan_tags ?? [])].sort((a, b) => a.priority - b.priority)[0];
    const stake = stakes.find((s) => s.salient && s.phase === 'pre_match' && s.team_id === p.id);
    const text = tag ? localized(tag.text, lang) : stake ? localized(stake.text, lang) : '';
    if (text) out.push({ key: p.id, text: `${p.short_name || p.name}: ${text}` });
  }
  return out;
}

function EventRow({
  event,
  time,
  competition,
  competitionLogo,
  round,
  venue,
  city,
  derby,
  stakes,
  referee,
  refereeLabel,
  penalties,
  shortNames,
  link,
  newTab,
  lang,
}: {
  event: GsEvent;
  time: string;
  /** Nome do campeonato na linha (lista sem agrupar). */
  competition: boolean;
  competitionLogo: boolean;
  round: boolean;
  venue: boolean;
  city: boolean;
  derby: boolean;
  stakes: boolean;
  referee: boolean;
  refereeLabel: string;
  penalties: boolean;
  shortNames: boolean;
  link: string | null;
  newTab: boolean;
  lang: string | undefined;
}) {
  const { home, away } = sidesOf(event);
  const started = STARTED_STATUSES.has(event.status);
  const showBadge = started || event.status !== 'scheduled';
  const place = [venue ? event.venue?.name : null, city ? event.venue?.city : null]
    .filter(Boolean)
    .join(', ');
  const comp = competition ? event.competition : null;
  const stage = round ? event.stage?.name : null;
  const ref = referee ? event.referee?.name : null;
  const derbyName = derby ? event.derby?.name : null;
  const tags = stakes ? stakeTags(event, lang) : [];
  const pen =
    penalties && event.score.penalty && event.score.penalty.home !== null ? event.score.penalty : null;
  const content = (
    <>
      <div className="gs-row-status">
        {showBadge ? <StatusBadge event={event} /> : <time dateTime={event.starts_at}>{time}</time>}
      </div>
      <div className="gs-row-teams">
        <Line p={home} short={shortNames} goals={started ? event.score.home : null} pen={pen?.home} />
        <Line p={away} short={shortNames} goals={started ? event.score.away : null} pen={pen?.away} />
        {comp || stage || place || ref ? (
          <div className="gs-row-meta">
            {comp ? (
              <span data-gs-meta="competition">
                {competitionLogo ? <Crest src={comp.logo} name={comp.name} size="xs" /> : null}
                <span className="gs-truncate">{comp.name}</span>
              </span>
            ) : null}
            {stage ? <span data-gs-meta="round">{stage}</span> : null}
            {place ? <span data-gs-meta="venue">{place}</span> : null}
            {ref ? <span data-gs-meta="referee">{`${refereeLabel}: ${ref}`}</span> : null}
          </div>
        ) : null}
        {derbyName || tags.length ? (
          <div className="gs-row-tags">
            {derbyName ? (
              <span className="gs-row-tag" data-tag="derby">
                {derbyName}
              </span>
            ) : null}
            {tags.map((t) => (
              <span key={t.key} className="gs-row-tag" data-tag="stake">
                {t.text}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
  if (!link)
    return (
      <li className="gs-row" data-gs-event={event.id}>
        {content}
      </li>
    );
  return (
    <li className="gs-row" data-gs-event={event.id} data-linked="">
      <a
        className="gs-row-link"
        href={eventLinkFor(link, event.id)}
        {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {content}
      </a>
    </li>
  );
}

function Line({
  p,
  short,
  goals,
  pen,
}: {
  p: GsParticipant | undefined;
  short: boolean;
  goals: number | null;
  pen: number | null | undefined;
}) {
  if (!p) return null;
  const name = short ? p.short_name || p.name : p.name;
  return (
    <div className="gs-line" data-lost={p.winner === false || undefined}>
      <Crest src={p.logo} name={p.name} size="sm" />
      <span className="gs-truncate" title={name === p.name ? undefined : p.name}>
        {name}
      </span>
      {goals !== null ? (
        <span className="gs-line-score">
          {goals}
          {pen !== null && pen !== undefined ? <span className="gs-line-pen">({pen})</span> : null}
        </span>
      ) : null}
    </div>
  );
}
