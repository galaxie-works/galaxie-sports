'use client';

import { fillText, sidesOf, type GsEvent, type GsHeadToHead } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface HeadToHeadProps {
  /** Id do evento na API Galaxie (o confronto é entre os dois times dele). */
  eventId: string;
  /** Quantos confrontos recentes listar (padrão 5). */
  limit?: number | undefined;
}

/** O retrospecto muda só quando um confronto termina: 30 minutos. */
const H2H_REFRESH_MS = 30 * 60_000;

/**
 * Confronto direto entre os dois times do jogo: vitórias de cada lado e empates (o histórico geral, quando
 * é um clássico com número curado) e os últimos jogos entre eles.
 */
export function HeadToHead({ eventId, limit = 5 }: HeadToHeadProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.h2h;
  const max = Math.min(Math.max(Math.round(limit) || 5, 1), 20);
  const query = useGalaxieQuery<GsHeadToHead>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}/h2h` : null,
    { limit: max },
    () => H2H_REFRESH_MS,
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="head_to_head" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const h2h = query.data;
  const [a, b] = h2h.participants;
  // histórico geral curado quando há; senão, o recorte da base
  const all = h2h.all_time;
  const total = all ? all.matches : h2h.summary.played;
  const draws = all ? all.draws : h2h.summary.draws;
  const winsOf = (id: string | undefined) =>
    (all ? all.teams : h2h.summary.teams).find((x) => x.id === id)?.wins ?? 0;
  const winsA = winsOf(a?.id);
  const winsB = winsOf(b?.id);
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const caption = all
    ? fillText(t.allTime, { n: all.matches })
    : h2h.summary.since
      ? fillText(t.since, { n: h2h.summary.played, year: h2h.summary.since })
      : fillText(t.played, { n: h2h.summary.played });
  const events = h2h.events.slice(0, max);

  return (
    <WidgetFrame kind="head_to_head">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
        <span className="gs-spacer" />
        {all?.derby ? <span className="gs-tag">{all.derby.name}</span> : null}
      </header>
      {!a || !b || total === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <>
          <div className="gs-h2h">
            <div className="gs-stat">
              <Crest src={a.logo} name={a.name} size="sm" />
              <strong>{winsA}</strong>
              <span className="gs-muted gs-small gs-truncate">{a.name}</span>
            </div>
            <div className="gs-stat">
              <span className="gs-muted gs-small">{t.draws}</span>
              <strong>{draws}</strong>
            </div>
            <div className="gs-stat">
              <Crest src={b.logo} name={b.name} size="sm" />
              <strong>{winsB}</strong>
              <span className="gs-muted gs-small gs-truncate">{b.name}</span>
            </div>
          </div>
          <div
            className="gs-bar"
            role="img"
            aria-label={`${a.name} ${winsA} · ${t.draws} ${draws} · ${b.name} ${winsB}`}
          >
            <span data-part="home" style={{ width: pct(winsA) }} />
            <span data-part="draw" style={{ width: pct(draws) }} />
            <span data-part="away" style={{ width: pct(winsB) }} />
          </div>
          <span className="gs-muted gs-small">{caption}</span>
        </>
      )}
      {events.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.recent}</div>
          <ul className="gs-list">
            {events.map((e) => (
              <Meeting key={e.id} event={e} date={fmt.date(e.starts_at)} />
            ))}
          </ul>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function Meeting({ event, date }: { event: GsEvent; date: string }) {
  const { home, away } = sidesOf(event);
  if (!home || !away) return null;
  return (
    <li className="gs-fixture" data-gs-event={event.id}>
      <time className="gs-fixture-date" dateTime={event.starts_at}>
        {date}
      </time>
      <span className="gs-meeting">
        <Crest src={home.logo} name={home.name} size="xs" />
        <span className="gs-truncate" data-lost={home.winner === false || undefined}>
          {home.short_name ?? home.name}
        </span>
        <strong>
          {event.score.home ?? 0} – {event.score.away ?? 0}
        </strong>
        <span className="gs-truncate" data-lost={away.winner === false || undefined}>
          {away.short_name ?? away.name}
        </span>
        <Crest src={away.logo} name={away.name} size="xs" />
      </span>
    </li>
  );
}
