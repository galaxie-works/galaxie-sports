'use client';

import {
  LIVE_STATUSES,
  fillText,
  isoDate,
  localTimeZone,
  type GsEvent,
  type GsEventList,
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

export interface RaceWeekendProps {
  /** Id de qualquer sessão do Grande Prêmio (a corrida, por exemplo). */
  eventId: string;
  /** Vencedor de cada sessão encerrada (padrão: sim). */
  showWinners?: boolean | undefined;
  /** Circuito no rodapé (padrão: sim). */
  showVenue?: boolean | undefined;
  /** Botão "adicionar ao calendário" nas sessões que não começaram (padrão: não). */
  showCalendar?: boolean | undefined;
}

const DAY_MS = 24 * 60 * 60_000;
const LIVE_REFRESH_MS = 30_000;
const WEEKEND_REFRESH_MS = 15 * 60_000;

/** Vencedor da sessão: o 1º colocado. */
const winnerOf = (e: GsEvent) => e.participants.find((p) => p.position === 1);

/**
 * Fim de semana do Grande Prêmio: as sessões (treinos, classificação, sprint e corrida) com dia e hora no
 * fuso do leitor, a sessão ao vivo em destaque e o vencedor de cada uma que terminou.
 */
export function RaceWeekend({
  eventId,
  showWinners = true,
  showVenue = true,
  showCalendar = false,
}: RaceWeekendProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.racing;
  const tz = timeZone ?? localTimeZone();
  const anchor = useGalaxieQuery<GsEvent>(eventId ? `/v1/events/${encodeURIComponent(eventId)}` : null);
  const event = anchor.data;
  const at = event ? Date.parse(event.starts_at) : NaN;
  const sessions = useGalaxieQuery<GsEventList>(
    event?.competition && !Number.isNaN(at) ? '/v1/events' : null,
    {
      competition: event?.competition?.id,
      from: Number.isNaN(at) ? undefined : isoDate(new Date(at - 4 * DAY_MS), tz),
      to: Number.isNaN(at) ? undefined : isoDate(new Date(at + 4 * DAY_MS), tz),
      limit: 50,
    },
    (list) => (list.data.some((e) => LIVE_STATUSES.has(e.status)) ? LIVE_REFRESH_MS : WEEKEND_REFRESH_MS),
  );
  if (!event || !sessions.data) {
    const state = event ? sessions : anchor;
    return (
      <WidgetFrame kind="race_weekend" busy={state.loading}>
        <h3 className="gs-title">{t.weekend}</h3>
        {state.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  // as sessões do mesmo GP (a fase); sem fase, as do circuito
  const sameWeekend = (e: GsEvent) =>
    event.stage?.name ? e.stage?.name === event.stage.name : e.venue?.name === event.venue?.name;
  const list = sessions.data.data
    .filter(sameWeekend)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const items = list.length ? list : [event];
  return (
    <WidgetFrame kind="race_weekend">
      <header className="gs-header">
        {event.competition ? (
          <Crest src={event.competition.logo} name={event.competition.name} size="sm" />
        ) : null}
        <h3 className="gs-title gs-truncate">{event.stage?.name ?? t.weekend}</h3>
      </header>
      {items.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <ul className="gs-list">
          {items.map((e) => {
            const winner = showWinners && e.status === 'finished' ? winnerOf(e) : undefined;
            const live = LIVE_STATUSES.has(e.status);
            return (
              <li key={e.id} className="gs-fixture" data-gs-event={e.id} data-live={live || undefined}>
                <time className="gs-fixture-date" dateTime={e.starts_at}>
                  {fmt.dayMonth(e.starts_at)} · {fmt.time(e.starts_at)}
                </time>
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-line">
                    <span className="gs-truncate gs-strong">{e.session?.name ?? e.stage?.name}</span>
                  </span>
                  {winner ? (
                    <span className="gs-line gs-meta">
                      <Crest src={winner.photo?.url ?? winner.logo} name={winner.name} size="xs" />
                      <span className="gs-truncate">{fillText(t.winner, { name: winner.name })}</span>
                    </span>
                  ) : null}
                </span>
                {showCalendar && e.status === 'scheduled' ? <CalendarButton event={e} compact /> : null}
                {e.status !== 'scheduled' ? <StatusBadge event={e} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {showVenue && event.venue ? (
        <footer className="gs-footer">
          <span className="gs-truncate">
            {[event.venue.name, event.venue.city].filter(Boolean).join(', ')}
          </span>
        </footer>
      ) : null}
    </WidgetFrame>
  );
}
