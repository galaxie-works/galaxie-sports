'use client';

import {
  LIVE_STATUSES,
  fillText,
  isoDate,
  localTimeZone,
  sidesOf,
  type GsCompetition,
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

export interface SeasonCalendarProps {
  /** UUID ou slug da competição (F1, UFC…). */
  competitionId: string;
  /** `season`: a temporada inteira (padrão na F1); `upcoming`: só o que vem pela frente (padrão no MMA). */
  range?: 'season' | 'upcoming' | undefined;
  /** Quantas etapas listar (padrão: todas). */
  limit?: number | undefined;
  /** Vencedor de cada etapa encerrada (padrão: sim). */
  showWinners?: boolean | undefined;
  /** Local da etapa (padrão: sim). */
  showVenue?: boolean | undefined;
}

const DAY_MS = 24 * 60 * 60_000;
const UPCOMING_DAYS = 180;
const CALENDAR_REFRESH_MS = 30 * 60_000;
const LIVE_REFRESH_MS = 60_000;

/** Uma etapa do calendário: o GP (sessões da mesma fase) ou o card de MMA (lutas do mesmo card). */
interface Round {
  key: string;
  name: string;
  events: GsEvent[];
  /** A sessão principal: a corrida no GP, a luta principal no card. */
  main: GsEvent;
}

function roundsOf(events: GsEvent[]): Round[] {
  const by = new Map<string, GsEvent[]>();
  for (const e of events) {
    const key = e.fight?.card?.id ?? e.stage?.name ?? e.id;
    by.set(key, [...(by.get(key) ?? []), e]);
  }
  return [...by].map(([key, list]) => {
    const sorted = list.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const main =
      sorted.find((e) => e.session?.type === 'race') ??
      sorted.find((e) => e.fight?.main_event) ??
      sorted[sorted.length - 1]!;
    return {
      key,
      name: main.fight?.card?.name ?? main.stage?.name ?? main.competition?.name ?? '',
      events: sorted,
      main,
    };
  });
}

/**
 * Calendário da competição: na F1, os Grandes Prêmios da temporada (data da corrida, circuito e o
 * vencedor); no MMA, os próximos cards (data e a luta principal). A próxima etapa fica em destaque.
 */
export function SeasonCalendar({
  competitionId,
  range,
  limit,
  showWinners = true,
  showVenue = true,
}: SeasonCalendarProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const tz = timeZone ?? localTimeZone();
  const competition = useGalaxieQuery<GsCompetition>(
    competitionId ? `/v1/competitions/${encodeURIComponent(competitionId)}` : null,
    {},
    () => CALENDAR_REFRESH_MS,
  );
  const c = competition.data;
  const mode = range ?? (c?.sport === 'mma' ? 'upcoming' : 'season');
  const season = c?.seasons?.find((x) => x.current) ?? c?.seasons?.[0];
  const now = Date.now();
  const year = season?.year ?? new Date(now).getUTCFullYear();
  const params =
    mode === 'upcoming'
      ? { from: isoDate(new Date(now), tz), to: isoDate(new Date(now + UPCOMING_DAYS * DAY_MS), tz) }
      : { from: season?.start_date ?? `${year}-01-01`, to: season?.end_date ?? `${year}-12-31` };
  const events = useGalaxieQuery<GsEventList>(
    c ? '/v1/events' : null,
    { competition: c?.id, ...params, limit: 200 },
    (list) => (list.data.some((e) => LIVE_STATUSES.has(e.status)) ? LIVE_REFRESH_MS : CALENDAR_REFRESH_MS),
  );
  const t = c?.sport === 'mma' ? texts.fights : texts.racing;
  const title = c?.sport === 'mma' ? texts.fights.upcoming : texts.racing.calendar;
  if (!c || !events.data) {
    const state = c ? events : competition;
    return (
      <WidgetFrame kind="season_calendar" busy={state.loading}>
        <h3 className="gs-title">{title}</h3>
        {state.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const all = roundsOf(events.data.data.filter((e) => e.status !== 'cancelled'));
  const next = all.find((r) => r.main.status !== 'finished');
  const rounds = limit && limit > 0 ? all.slice(0, limit) : all;
  return (
    <WidgetFrame kind="season_calendar">
      <header className="gs-header">
        <Crest src={c.logo} name={c.name} size="sm" />
        <h3 className="gs-title gs-truncate">{c.name}</h3>
        <span className="gs-spacer" />
        {mode === 'season' ? <span>{season?.label ?? year}</span> : null}
      </header>
      {rounds.length === 0 ? (
        <EmptyState>{t.emptyCalendar}</EmptyState>
      ) : (
        <ol className="gs-list">
          {rounds.map((r, i) => {
            const e = r.main;
            const winner =
              showWinners && e.status === 'finished'
                ? (e.participants.find((p) => p.position === 1) ?? e.participants.find((p) => p.winner))
                : undefined;
            const { home, away } = sidesOf(e);
            const bout = e.fight && home && away ? `${home.name} × ${away.name}` : null;
            return (
              <li
                key={r.key}
                className="gs-fixture"
                data-gs-event={e.id}
                data-next={r === next || undefined}
                aria-current={r === next ? 'true' : undefined}
              >
                <time className="gs-fixture-date" dateTime={e.starts_at}>
                  {mode === 'season' ? <span className="gs-muted">{i + 1}. </span> : null}
                  {fmt.dayMonth(e.starts_at)}
                </time>
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-line">
                    <span className="gs-truncate gs-strong">{r.name}</span>
                    {r === next ? <span className="gs-tag">{texts.racing.next}</span> : null}
                  </span>
                  {bout || (showVenue && e.venue) ? (
                    <span className="gs-line gs-meta">
                      <span className="gs-truncate">
                        {[bout, showVenue ? e.venue?.name : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  ) : null}
                  {winner ? (
                    <span className="gs-line gs-meta">
                      <Crest src={winner.photo?.url ?? winner.logo} name={winner.name} size="xs" />
                      <span className="gs-truncate">
                        {fillText(texts.racing.winner, { name: winner.name })}
                      </span>
                    </span>
                  ) : null}
                </span>
                {LIVE_STATUSES.has(e.status) ? <StatusBadge event={e} /> : null}
              </li>
            );
          })}
        </ol>
      )}
    </WidgetFrame>
  );
}
