'use client';

import { LIVE_STATUSES, STARTED_STATUSES, eventRefreshMs, sidesOf, type GsEvent } from '../core/model.js';
import {
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
}

/** Placar de um jogo: escudos, placar, minuto ao vivo, competição e horário local. */
export function MatchCard({ eventId }: MatchCardProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const query = useGalaxieQuery<GsEvent>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}` : null,
    {},
    (event) => eventRefreshMs(event),
  );

  if (!query.data) {
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

  const event = query.data;
  const { home, away } = sidesOf(event);
  const started = STARTED_STATUSES.has(event.status);
  const live = LIVE_STATUSES.has(event.status);
  const { score } = event;
  const hasScore = score.home !== null || score.away !== null;
  const penalty = score.penalty && score.penalty.home !== null ? score.penalty : null;

  return (
    <WidgetFrame kind="match_card">
      <header className="gs-header">
        {event.competition ? (
          <Crest src={event.competition.logo} name={event.competition.name} size="sm" />
        ) : null}
        <span className="gs-truncate">
          {[event.competition?.name, event.stage?.name].filter(Boolean).join(' · ')}
        </span>
        <span className="gs-spacer" />
        <StatusBadge event={event} />
      </header>

      <div className="gs-match">
        <div className="gs-team" data-lost={home?.winner === false || undefined}>
          <Crest src={home?.logo} name={home?.name ?? '?'} />
          <span>{home?.short_name ?? home?.name}</span>
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
          </div>
        ) : (
          <span className="gs-versus">{texts.versus}</span>
        )}
        <div className="gs-team" data-lost={away?.winner === false || undefined}>
          <Crest src={away?.logo} name={away?.name ?? '?'} />
          <span>{away?.short_name ?? away?.name}</span>
        </div>
      </div>

      <footer className="gs-footer">
        <time dateTime={event.starts_at}>{fmt.dateTime(event.starts_at)}</time>
        {event.venue ? (
          <span className="gs-truncate">
            {[event.venue.name, event.venue.city].filter(Boolean).join(', ')}
          </span>
        ) : null}
      </footer>
    </WidgetFrame>
  );
}
