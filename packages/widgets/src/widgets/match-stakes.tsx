'use client';

import {
  apiLocale,
  eventRefreshMs,
  localized,
  sidesOf,
  type GsCompetitionContext,
  type GsEvent,
  type GsParticipant,
  type GsStake,
} from '../core/model.js';
import {
  CompetitionSituation,
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
  /** `salient` (padrão): os 3 principais de cada time; `all`: todos. */
  stakes?: 'salient' | 'all' | undefined;
  /** Tags da torcida ("Na briga pelo título") (padrão: sim). */
  showFanTags?: boolean | undefined;
  /** Grito da arquibancada (padrão: sim). */
  showCheer?: boolean | undefined;
  /** Intensidade do clássico, de 1 a 5 (padrão: não). */
  showDerbyIntensity?: boolean | undefined;
  /** Depois do jogo, o que o resultado mudou (padrão: sim); desligado, o que estava em jogo. */
  showResultStakes?: boolean | undefined;
  /** Líder e próximos jogos decisivos do campeonato (padrão: não). */
  showCompetitionContext?: boolean | undefined;
}

/** A situação do campeonato muda com a rodada: 10 minutos. */
const CONTEXT_REFRESH_MS = 10 * 60_000;

/**
 * O que está em jogo, do ponto de vista de cada torcida: o que o time precisa (motor de regras), as tags
 * do torcedor ("Na briga pelo título") e o grito da torcida. Jogo encerrado mostra o que o resultado mudou.
 */
export function MatchStakes({
  eventId,
  stakes: list = 'salient',
  showFanTags = true,
  showCheer = true,
  showDerbyIntensity = false,
  showResultStakes = true,
  showCompetitionContext = false,
}: MatchStakesProps) {
  const { texts, locale, market } = useGalaxieWidget();
  const t = texts.stakes;
  const query = useGalaxieQuery<GsEvent>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}` : null,
    { market, stakes: list === 'all' ? 'all' : undefined },
    (event) => eventRefreshMs(event),
  );
  const competitionId = query.data?.competition?.id;
  const context = useGalaxieQuery<GsCompetitionContext>(
    competitionId && showCompetitionContext
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/context`
      : null,
    {},
    () => CONTEXT_REFRESH_MS,
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
  const phase = showResultStakes && stakes.some((s) => s.phase === 'result') ? 'result' : 'pre_match';
  const all = list === 'all';
  const lang = apiLocale(locale, market);
  const sides = [
    { side: 'home' as const, p: home },
    { side: 'away' as const, p: away },
  ].filter((s): s is { side: 'home' | 'away'; p: GsParticipant } => Boolean(s.p));
  const hasContent = sides.some(
    ({ side, p }) =>
      (showFanTags && (p.fan_tags?.length ?? 0) > 0) ||
      (showCheer && p.cheer) ||
      stakesOf(stakes, side, phase, all).length > 0,
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
          {showDerbyIntensity ? (
            <span
              className="gs-tag"
              data-gs-intensity={event.derby.intensity}
            >{`${texts.extra.intensity} ${'●'.repeat(event.derby.intensity)}${'○'.repeat(Math.max(0, 5 - event.derby.intensity))}`}</span>
          ) : null}
        </div>
      ) : null}
      {hasContent ? (
        <div className="gs-sides">
          {sides.map(({ side, p }) => {
            const lines = stakesOf(stakes, side, phase, all);
            return (
              <section key={p.id} className="gs-side" data-gs-side={side}>
                <div className="gs-side-head">
                  <Crest src={p.logo} name={p.name} size="sm" />
                  <span className="gs-truncate">{p.short_name ?? p.name}</span>
                </div>
                {showFanTags && p.fan_tags?.length ? (
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
                {showCheer && p.cheer ? (
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
      {showCompetitionContext && context.data ? <CompetitionSituation context={context.data} /> : null}
    </WidgetFrame>
  );
}

function stakesOf(
  stakes: GsStake[],
  side: 'home' | 'away',
  phase: GsStake['phase'],
  all: boolean,
): GsStake[] {
  return stakes.filter(
    (s) => s.phase === phase && (all || s.salient) && (s.team === side || s.team === 'both'),
  );
}
