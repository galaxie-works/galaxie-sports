'use client';

import type { GsStandingRow, GsStandings } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface StandingsTableProps {
  /** UUID ou slug da competição. */
  competitionId: string;
  /** Ano da temporada; padrão: a atual. */
  season?: number | 'current' | undefined;
  /** Mostra só as primeiras N linhas de cada grupo. */
  limit?: number | undefined;
}

/** A tabela muda pouco: atualiza a cada 10 minutos. */
const STANDINGS_REFRESH_MS = 10 * 60_000;

/** Classificação da competição (um bloco por grupo), com a zona de classificação marcada na cor primária. */
export function StandingsTable({ competitionId, season, limit }: StandingsTableProps) {
  const { texts } = useGalaxieWidget();
  const query = useGalaxieQuery<GsStandings>(
    competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/seasons/${season ?? 'current'}/standings`
      : null,
    {},
    () => STANDINGS_REFRESH_MS,
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="standings" busy={query.loading}>
        <h3 className="gs-title">{texts.standings}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const groups = query.data.groups.filter((g) => g.rows.length > 0);
  const c = texts.columns;
  return (
    <WidgetFrame kind="standings">
      <header className="gs-header">
        <h3 className="gs-title">{texts.standings}</h3>
        <span className="gs-spacer" />
        <span>{query.data.season.label}</span>
      </header>
      {groups.length === 0 ? (
        <EmptyState>{texts.emptyStandings}</EmptyState>
      ) : (
        groups.map((group, i) => (
          <div key={group.name ?? i} className="gs-group">
            {group.name ? <div className="gs-group-title">{group.name}</div> : null}
            <div className="gs-scroll">
              <table className="gs-table">
                <thead>
                  <tr>
                    <th className="gs-left" scope="col">
                      #
                    </th>
                    <th className="gs-left" scope="col">
                      {c.team}
                    </th>
                    <th scope="col">{c.points}</th>
                    <th scope="col">{c.played}</th>
                    <th scope="col">{c.won}</th>
                    <th scope="col">{c.drawn}</th>
                    <th scope="col">{c.lost}</th>
                    <th scope="col">{c.goalDiff}</th>
                  </tr>
                </thead>
                <tbody>
                  {(limit ? group.rows.slice(0, limit) : group.rows).map((row) => (
                    <Row key={row.participant.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </WidgetFrame>
  );
}

function Row({ row }: { row: GsStandingRow }) {
  return (
    <tr>
      <td
        className="gs-left gs-rank"
        data-zone={row.description ? '' : undefined}
        title={row.description ?? undefined}
      >
        {row.rank}
      </td>
      <td className="gs-left">
        <div className="gs-line">
          <Crest src={row.participant.logo} name={row.participant.name} size="sm" />
          <span className="gs-truncate">{row.participant.short_name ?? row.participant.name}</span>
        </div>
      </td>
      <td className="gs-strong">{row.points}</td>
      <td>{row.played}</td>
      <td>{row.won}</td>
      <td>{row.drawn}</td>
      <td>{row.lost}</td>
      <td>{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
    </tr>
  );
}
