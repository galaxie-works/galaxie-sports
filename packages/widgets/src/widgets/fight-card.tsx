'use client';

import { LIVE_STATUSES, fillText, sidesOf, type GsEvent, type GsFightCard } from '../core/model.js';
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

export interface FightCardProps {
  /** Id de qualquer luta do card na API Galaxie. */
  eventId: string;
  /** Preliminares além do card principal (padrão: sim). */
  showPrelims?: boolean | undefined;
  /** Categoria de peso de cada luta (padrão: sim). */
  showWeightClass?: boolean | undefined;
  /** Desfecho (método, round e tempo) das lutas encerradas (padrão: sim). */
  showResults?: boolean | undefined;
}

const SEGMENTS = ['main_card', 'prelims', 'early_prelims'] as const;
const LIVE_REFRESH_MS = 30_000;
const CARD_REFRESH_MS = 15 * 60_000;

/**
 * Card de um evento de MMA: a luta principal e o card principal, depois as preliminares, com a categoria de
 * cada luta e, nas encerradas, o vencedor e o método (nocaute, finalização, decisão) com round e tempo.
 */
export function FightCard({
  eventId,
  showPrelims = true,
  showWeightClass = true,
  showResults = true,
}: FightCardProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.fights;
  const query = useGalaxieQuery<GsFightCard>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}/card` : null,
    {},
    (card) => (card.fights.some((f) => LIVE_STATUSES.has(f.status)) ? LIVE_REFRESH_MS : CARD_REFRESH_MS),
  );
  const data = query.data;
  if (!data) {
    return (
      <WidgetFrame kind="fight_card" busy={query.loading}>
        <h3 className="gs-title">{t.card}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const fights = data.fights.filter((f) => f.status !== 'cancelled');
  const segments = SEGMENTS.filter((s) => showPrelims || s === 'main_card')
    .map((segment) => ({
      segment,
      fights: fights.filter((f) => (f.fight?.segment ?? 'main_card') === segment),
    }))
    .filter((g) => g.fights.length);
  return (
    <WidgetFrame kind="fight_card">
      <header className="gs-header">
        {fights[0]?.competition ? (
          <Crest src={fights[0].competition.logo} name={fights[0].competition.name} size="sm" />
        ) : null}
        <h3 className="gs-title gs-truncate">{data.card.name}</h3>
        <span className="gs-spacer" />
        <time dateTime={data.card.starts_at}>{fmt.dateTime(data.card.starts_at)}</time>
      </header>
      {segments.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        segments.map((g) => (
          <div key={g.segment} className="gs-group">
            <div className="gs-group-title">{t.segments[g.segment]}</div>
            <ul className="gs-list">
              {g.fights.map((f) => (
                <Bout key={f.id} fight={f} showWeightClass={showWeightClass} showResults={showResults} />
              ))}
            </ul>
          </div>
        ))
      )}
    </WidgetFrame>
  );
}

/** Uma luta: os dois lutadores (o vencedor em destaque), a categoria e o desfecho. */
function Bout({
  fight,
  showWeightClass,
  showResults,
}: {
  fight: GsEvent;
  showWeightClass: boolean;
  showResults: boolean;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.fights;
  const { home, away } = sidesOf(fight);
  const res = showResults && fight.status === 'finished' ? fight.fight?.result : null;
  const how = res
    ? [
        res.method_name,
        res.detail,
        res.round
          ? fillText(t.roundTime, { round: res.round, time: res.time ?? '' }).replace(/ · $/, '')
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const meta = [
    fight.fight?.main_event ? t.mainEvent : null,
    showWeightClass ? fight.fight?.weight_class?.name : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="gs-bout" data-gs-event={fight.id} data-live={LIVE_STATUSES.has(fight.status) || undefined}>
      {meta ? <span className="gs-meta gs-small">{meta}</span> : null}
      <div className="gs-meeting">
        <Crest src={home?.logo} name={home?.name ?? '?'} size="xs" />
        <span
          className="gs-truncate"
          data-won={home?.winner === true || undefined}
          data-lost={home?.winner === false || undefined}
        >
          {home?.name ?? '?'}
        </span>
        <span className="gs-muted">{texts.versus}</span>
        <span
          className="gs-truncate"
          data-won={away?.winner === true || undefined}
          data-lost={away?.winner === false || undefined}
        >
          {away?.name ?? '?'}
        </span>
        <Crest src={away?.logo} name={away?.name ?? '?'} size="xs" />
        {LIVE_STATUSES.has(fight.status) ? <StatusBadge event={fight} /> : null}
      </div>
      {how ? <span className="gs-meta gs-small">{how}</span> : null}
      {res?.scorecards.length ? (
        <span className="gs-meta gs-small">
          {fillText(t.scorecards, { cards: res.scorecards.join(', ') })}
        </span>
      ) : null}
    </li>
  );
}
