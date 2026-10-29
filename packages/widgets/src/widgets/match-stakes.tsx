'use client';

import {
  apiLocale,
  eventRefreshMs,
  localized,
  sidesOf,
  type GsEvent,
  type GsParticipant,
  type GsStake,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface MatchStakesProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
}

/**
 * O que está em jogo, do ponto de vista de cada torcida: o que o time precisa (motor de regras), as tags
 * do torcedor ("Na briga pelo título") e o grito da torcida. Jogo encerrado mostra o que o resultado mudou.
 */
export function MatchStakes({ eventId }: MatchStakesProps) {
  const { texts, locale, market } = useGalaxieWidget();
  const t = texts.stakes;
  const query = useGalaxieQuery<GsEvent>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}` : null,
    { market },
    (event) => eventRefreshMs(event),
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="match_stakes" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const event = query.data;
  const { home, away } = sidesOf(event);
  const stakes = event.stakes ?? [];
  // encerrado: o que o placar mudou, quando a API traz; senão, o que estava em jogo
  const phase = stakes.some((s) => s.phase === 'result') ? 'result' : 'pre_match';
  const lang = apiLocale(locale, market);
  const sides = [
    { side: 'home' as const, p: home },
    { side: 'away' as const, p: away },
  ].filter((s): s is { side: 'home' | 'away'; p: GsParticipant } => Boolean(s.p));
  const hasContent = sides.some(
    ({ side, p }) => (p.fan_tags?.length ?? 0) > 0 || p.cheer || stakesOf(stakes, side, phase).length > 0,
  );

  return (
    <WidgetFrame kind="match_stakes">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
        <span className="gs-spacer" />
        <StatusBadge event={event} />
      </header>
      {event.derby ? (
        <div className="gs-chips">
          <span className="gs-tag">{`${t.derby} · ${event.derby.name}`}</span>
        </div>
      ) : null}
      {hasContent ? (
        <div className="gs-sides">
          {sides.map(({ side, p }) => {
            const lines = stakesOf(stakes, side, phase);
            return (
              <section key={p.id} className="gs-side" data-gs-side={side}>
                <div className="gs-side-head">
                  <Crest src={p.logo} name={p.name} size="sm" />
                  <span className="gs-truncate">{p.short_name ?? p.name}</span>
                </div>
                {p.fan_tags?.length ? (
                  <div className="gs-chips">
                    {p.fan_tags.map((tag) => (
                      <span key={tag.code} className="gs-tag">
                        {localized(tag.text, lang)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {lines.length ? (
                  <ul className="gs-bullets">
                    {lines.map((s) => (
                      <li key={`${s.code}-${s.team}`}>{localized(s.text, lang)}</li>
                    ))}
                  </ul>
                ) : null}
                {p.cheer ? (
                  <blockquote className="gs-cheer" aria-label={t.cheer}>
                    {p.cheer.text}
                  </blockquote>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState>{t.empty}</EmptyState>
      )}
    </WidgetFrame>
  );
}

function stakesOf(stakes: GsStake[], side: 'home' | 'away', phase: GsStake['phase']): GsStake[] {
  return stakes.filter((s) => s.phase === phase && s.salient && (s.team === side || s.team === 'both'));
}
