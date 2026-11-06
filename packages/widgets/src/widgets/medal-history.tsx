'use client';

import { fillText, type GsMedalHistory } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  MedalDot,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface MedalHistoryProps {
  /** País pelo código do COI (padrão BRA). */
  noc?: string | undefined;
  /** Quais Jogos: `OG` (Olimpíadas), `PAN` (Pan-Americanos) ou os dois (padrão). */
  type?: 'OG' | 'PAN' | 'OG,PAN' | undefined;
  /** Temporada (padrão: verão). */
  season?: 'summer' | 'winter' | undefined;
  /** Quantas edições, das mais recentes (padrão 10; 0 = todas). */
  limit?: number | undefined;
}

const REFRESH_MS = 24 * 60 * 60_000;

/** Medalhas do país em cada edição dos Jogos (da mais recente para trás) e a soma de todas. */
export function MedalHistory({
  noc = 'BRA',
  type = 'OG,PAN',
  season = 'summer',
  limit = 10,
}: MedalHistoryProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.olympics;
  const code = (noc || 'BRA').toUpperCase();
  const query = useGalaxieQuery<GsMedalHistory>(
    '/v1/multisport/history/medals',
    { noc: code, type, season },
    () => REFRESH_MS,
  );
  const h = query.data;
  if (!h) {
    return (
      <WidgetFrame kind="medal_history" busy={query.loading}>
        <h3 className="gs-title">{t.history}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const country = h.nocs.find((n) => n.code === code);
  const rows = h.data
    .filter((r) => r.noc === code)
    .sort((a, b) => b.games.year - a.games.year || a.games.type.localeCompare(b.games.type));
  const shown = limit > 0 ? rows.slice(0, limit) : rows;
  const total = h.totals.find((x) => x.noc === code);
  return (
    <WidgetFrame kind="medal_history">
      <header className="gs-header">
        <Flag iso2={country?.iso2} code={code} name={country?.name} />
        <h3 className="gs-title gs-truncate">{`${t.history} · ${country?.name ?? code}`}</h3>
      </header>
      {shown.length === 0 ? (
        <EmptyState>{t.withheld}</EmptyState>
      ) : (
        <table className="gs-table" data-gs-medal-history="">
          <thead>
            <tr>
              <th className="gs-left" scope="col">
                {t.edition}
              </th>
              <th scope="col">
                <MedalDot medal="G" label={t.gold} />
              </th>
              <th scope="col">
                <MedalDot medal="S" label={t.silver} />
              </th>
              <th scope="col">
                <MedalDot medal="B" label={t.bronze} />
              </th>
              <th scope="col">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.games.slug} data-gs-games={r.games.slug}>
                <td className="gs-left gs-truncate">{r.games.name}</td>
                <td>{r.gold}</td>
                <td>{r.silver}</td>
                <td>{r.bronze}</td>
                <td className="gs-strong">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total ? (
        <footer className="gs-footer">
          <span>{fillText(t.totals, { n: rows.length })}</span>
          <span className="gs-strong">{`${total.gold} · ${total.silver} · ${total.bronze} · ${total.total}`}</span>
        </footer>
      ) : null}
    </WidgetFrame>
  );
}
