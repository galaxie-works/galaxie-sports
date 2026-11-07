'use client';

import { fillText, type GsEventPredictions, type GsGoalsLine } from '../core/model.js';
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

export interface MatchPredictionProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /** Chances de cada resultado, com a barra (padrão: sim). */
  showProbabilities?: boolean | undefined;
  /** Quem o palpite aponta (padrão: sim). */
  showWinner?: boolean | undefined;
  /** Linhas de gols do jogo e de cada time (padrão: sim). */
  showGoals?: boolean | undefined;
  /** Comparação dos times: momento, ataque, defesa, confronto direto (padrão: sim). */
  showComparison?: boolean | undefined;
  /** Aviso de que é um palpite estatístico, no rodapé (padrão: sim). */
  showNote?: boolean | undefined;
}

/** O palpite é renovado uma vez por dia: 30 minutos bastam. */
const PREDICTION_REFRESH_MS = 30 * 60_000;

/**
 * Palpite do jogo (futebol): a chance de cada resultado, quem deve vencer (ou "vence ou empata"), a linha de gols
 * e a comparação dos dois times. O texto é montado aqui, no idioma do widget, a partir dos números da API.
 */
export function MatchPrediction({
  eventId,
  showProbabilities = true,
  showWinner = true,
  showGoals = true,
  showComparison = true,
  showNote = true,
}: MatchPredictionProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.prediction;
  const query = useGalaxieQuery<GsEventPredictions>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}/predictions` : null,
    {},
    () => PREDICTION_REFRESH_MS,
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="match_prediction" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const { home, away, prediction: p, updated_at } = query.data;
  const nameOf = (side: 'home' | 'away') => {
    const team = side === 'home' ? home : away;
    return team?.short_name ?? team?.name ?? '';
  };
  const line = (n: number) => (Number.isInteger(n) ? fmt.integer(n) : String(fmt.decimal(n)));
  const goalsText = (g: GsGoalsLine, team?: string) =>
    team
      ? fillText(g.side === 'over' ? t.teamOver : t.teamUnder, { team, line: line(g.line) })
      : fillText(g.side === 'over' ? t.over : t.under, { line: line(g.line) });
  const pct = (n: number | null) => (n == null ? '–' : `${fmt.integer(n)}%`);

  const probs = p?.probabilities;
  const withDraw = probs?.draw != null;
  const hasProbs = !!probs && (probs.home != null || probs.away != null);
  const goals = p
    ? [
        p.goals.total ? goalsText(p.goals.total) : null,
        p.goals.home ? goalsText(p.goals.home, nameOf('home')) : null,
        p.goals.away ? goalsText(p.goals.away, nameOf('away')) : null,
      ].filter((x): x is string => !!x)
    : [];
  const comparison = p?.comparison.filter((c) => c.home != null || c.away != null) ?? [];

  return (
    <WidgetFrame kind="match_prediction">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
      </header>
      {home && away ? (
        <div className="gs-line" data-gs-teams>
          <Crest src={home.logo} name={home.name} size="sm" />
          <span className="gs-truncate">{nameOf('home')}</span>
          <span className="gs-spacer" />
          <span className="gs-truncate">{nameOf('away')}</span>
          <Crest src={away.logo} name={away.name} size="sm" />
        </div>
      ) : null}
      {!p ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <>
          {showProbabilities && hasProbs ? (
            <div className="gs-group" data-gs-probabilities>
              <div className="gs-group-title">{t.probabilities}</div>
              <div className="gs-prediction-odds" data-no-draws={withDraw ? undefined : ''}>
                <div className="gs-stat">
                  <strong>{pct(probs.home)}</strong>
                  <span className="gs-muted gs-small">{t.home}</span>
                </div>
                {withDraw ? (
                  <div className="gs-stat">
                    <strong>{pct(probs.draw)}</strong>
                    <span className="gs-muted gs-small">{t.draw}</span>
                  </div>
                ) : null}
                <div className="gs-stat">
                  <strong>{pct(probs.away)}</strong>
                  <span className="gs-muted gs-small">{t.away}</span>
                </div>
              </div>
              <div
                className="gs-bar"
                role="img"
                aria-label={[
                  `${t.home} ${pct(probs.home)}`,
                  withDraw ? `${t.draw} ${pct(probs.draw)}` : null,
                  `${t.away} ${pct(probs.away)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <span data-part="home" style={{ width: `${probs.home ?? 0}%` }} />
                {withDraw ? <span data-part="draw" style={{ width: `${probs.draw ?? 0}%` }} /> : null}
                <span data-part="away" style={{ width: `${probs.away ?? 0}%` }} />
              </div>
            </div>
          ) : null}
          {showWinner ? (
            <p className="gs-strong" data-gs-winner>
              {p.winner
                ? fillText(p.winner.win_or_draw ? t.winsOrDraws : t.wins, { team: nameOf(p.winner.side) })
                : t.open}
            </p>
          ) : null}
          {showGoals && goals.length ? (
            <div className="gs-group" data-gs-goals>
              <div className="gs-group-title">{t.goals}</div>
              <ul className="gs-list">
                {goals.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {showComparison && comparison.length ? (
            <div className="gs-group" data-gs-comparison>
              <div className="gs-group-title">{t.comparisonTitle}</div>
              {comparison.map((c) => (
                <div className="gs-compare" key={c.key} data-gs-compare={c.key}>
                  <span className="gs-compare-label">{t.comparison[c.key]}</span>
                  <span>{pct(c.home)}</span>
                  <div
                    className="gs-bar"
                    role="img"
                    aria-label={`${t.comparison[c.key]}: ${nameOf('home')} ${pct(c.home)} · ${nameOf('away')} ${pct(c.away)}`}
                  >
                    <span data-part="home" style={{ width: `${c.home ?? 0}%` }} />
                    <span data-part="away" style={{ width: `${c.away ?? 0}%` }} />
                  </div>
                  <span>{pct(c.away)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      {p && (showNote || (updated_at && fmt.date(updated_at))) ? (
        <footer className="gs-footer" data-gs-updated>
          {showNote ? <span>{t.note}</span> : null}
          {updated_at && fmt.date(updated_at) ? (
            <span>
              {t.updatedAt} {fmt.date(updated_at)}
            </span>
          ) : null}
        </footer>
      ) : null}
    </WidgetFrame>
  );
}
