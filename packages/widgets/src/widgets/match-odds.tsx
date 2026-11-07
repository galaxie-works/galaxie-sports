'use client';

import { useMemo } from 'react';
import {
  fillText,
  pluralText,
  type GsEventOdds,
  type GsOddsMarketKey,
  type WidgetTexts,
} from '../core/model.js';
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

export interface MatchOddsProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /** Resultado final: mandante, empate, visitante (padrão: sim). */
  showMatchWinner?: boolean | undefined;
  /** Dupla chance (padrão: sim). */
  showDoubleChance?: boolean | undefined;
  /** Total de gols, na linha principal (padrão: sim). */
  showGoals?: boolean | undefined;
  /** Ambos marcam (padrão: sim). */
  showBothTeamsScore?: boolean | undefined;
  /** A maior odd entre as casas, abaixo da média (padrão: sim). */
  showBest?: boolean | undefined;
  /** Aviso de jogo responsável no rodapé (padrão: sim). */
  showNotice?: boolean | undefined;
}

/** As odds são buscadas uma vez por dia: 30 minutos bastam. */
const ODDS_REFRESH_MS = 30 * 60_000;

/** Ordem das seleções em cada mercado. */
const ORDER: Record<GsOddsMarketKey, string[]> = {
  match_winner: ['home', 'draw', 'away'],
  double_chance: ['home_draw', 'home_away', 'draw_away'],
  goals_over_under: ['over', 'under'],
  both_teams_score: ['yes', 'no'],
};

type Selection = GsEventOdds['markets'][number]['selections'][number];

/** Linha principal do total de gols: a oferecida por mais casas; no empate, a mais perto de 2,5. */
export function mainLine(selections: Selection[]): number | null {
  const by = new Map<number, number>();
  for (const s of selections) if (s.line != null) by.set(s.line, Math.max(by.get(s.line) ?? 0, s.bookmakers));
  let best: number | null = null;
  for (const [line, n] of by) {
    const cur = best == null ? -1 : by.get(best)!;
    if (n > cur || (n === cur && Math.abs(line - 2.5) < Math.abs(best! - 2.5))) best = line;
  }
  return best;
}

function selectionLabel(t: WidgetTexts['odds'], key: string, line: string | null): string {
  switch (key) {
    case 'home':
      return t.home;
    case 'draw':
      return t.draw;
    case 'away':
      return t.away;
    case 'home_draw':
      return t.homeDraw;
    case 'home_away':
      return t.homeAway;
    case 'draw_away':
      return t.drawAway;
    case 'over':
      return fillText(t.over, { line: line ?? '' });
    case 'under':
      return fillText(t.under, { line: line ?? '' });
    case 'yes':
      return t.yes;
    case 'no':
      return t.no;
    default:
      return key;
  }
}

/**
 * Odds pré-jogo do jogo, em consenso entre as casas: a odd média de cada resultado e, opcional, a maior. As casas
 * não são identificadas (decisão do dono, 07/11). O aviso de jogo responsável vem ligado por padrão.
 */
export function MatchOdds({
  eventId,
  showMatchWinner = true,
  showDoubleChance = true,
  showGoals = true,
  showBothTeamsScore = true,
  showBest = true,
  showNotice = true,
}: MatchOddsProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.odds;
  const odd = useMemo(
    () => new Intl.NumberFormat(fmt.intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [fmt.intl],
  );
  const query = useGalaxieQuery<GsEventOdds>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}/odds` : null,
    {},
    () => ODDS_REFRESH_MS,
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="match_odds" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const d = query.data;
  const enabled: Record<GsOddsMarketKey, boolean> = {
    match_winner: showMatchWinner,
    double_chance: showDoubleChance,
    goals_over_under: showGoals,
    both_teams_score: showBothTeamsScore,
  };
  const line = (n: number) => (Number.isInteger(n) ? fmt.integer(n) : fmt.decimal(n));
  const markets = (Object.keys(ORDER) as GsOddsMarketKey[]).flatMap((key) => {
    if (!enabled[key]) return [];
    const m = d.markets.find((x) => x.key === key);
    if (!m) return [];
    const main = key === 'goals_over_under' ? mainLine(m.selections) : null;
    const selections = ORDER[key]
      .map((k) => m.selections.find((s) => s.key === k && (main == null || s.line === main)))
      .filter((s): s is Selection => !!s);
    return selections.length ? [{ key, selections }] : [];
  });
  const home = d.home?.short_name ?? d.home?.name;
  const away = d.away?.short_name ?? d.away?.name;

  return (
    <WidgetFrame kind="match_odds">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
      </header>
      {d.home && d.away ? (
        <div className="gs-line" data-gs-teams>
          <Crest src={d.home.logo} name={d.home.name} size="sm" />
          <span className="gs-truncate">{home}</span>
          <span className="gs-spacer" />
          <span className="gs-truncate">{away}</span>
          <Crest src={d.away.logo} name={d.away.name} size="sm" />
        </div>
      ) : null}
      {!markets.length ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        markets.map((m) => (
          <div className="gs-group" key={m.key} data-gs-market={m.key}>
            <div className="gs-group-title">{t.markets[m.key]}</div>
            <div className="gs-odds-row">
              {m.selections.map((s) => (
                <div className="gs-odd" key={`${s.key}|${s.line ?? ''}`} data-gs-selection={s.key}>
                  <span className="gs-muted gs-small gs-truncate">
                    {selectionLabel(t, s.key, s.line == null ? null : line(s.line))}
                  </span>
                  <strong>{odd.format(s.average)}</strong>
                  {showBest && s.bookmakers > 1 ? (
                    <span className="gs-meta">{fillText(t.best, { odd: odd.format(s.best) })}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {markets.length ? (
        <footer className="gs-footer" data-gs-updated>
          <span>{pluralText(t.bookmakers, d.bookmakers, fmt.intl, fmt.integer)}</span>
          {d.updated_at && fmt.date(d.updated_at) ? (
            <span>
              {t.updatedAt} {fmt.date(d.updated_at)}
            </span>
          ) : null}
        </footer>
      ) : null}
      {showNotice ? (
        <p className="gs-notice" data-gs-notice>
          {t.notice}
        </p>
      ) : null}
    </WidgetFrame>
  );
}
