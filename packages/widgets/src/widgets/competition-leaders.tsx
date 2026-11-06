'use client';

import { fillText, type GsLeaderCategory, type GsLeaders } from '../core/model.js';
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

export interface CompetitionLeadersProps {
  /** Id ou slug do campeonato na API Galaxie. */
  competitionId: string;
  /** Ano da temporada (padrão: a atual). */
  season?: number | 'current' | undefined;
  /** Artilharia (`goals`), assistências (`assists`) ou cartões (`cards`). Padrão: artilharia. */
  category?: GsLeaderCategory | undefined;
  /** Quantos jogadores (1–50, padrão 10). */
  limit?: number | undefined;
}

const REFRESH_MS = 60 * 60_000;

/** Artilheiros, líderes de assistências ou de cartões de um campeonato, com o escudo do time. */
export function CompetitionLeaders({
  competitionId,
  season = 'current',
  category = 'goals',
  limit = 10,
}: CompetitionLeadersProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.championship;
  const size = Math.min(50, Math.max(1, Math.round(limit) || 10));
  const query = useGalaxieQuery<GsLeaders>(
    competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/seasons/${season || 'current'}/leaders`
      : null,
    { category, limit: size },
    () => REFRESH_MS,
  );
  const title = t.leaders[category] ?? t.leaders.goals;
  if (!competitionId) {
    return (
      <WidgetFrame kind="competition_leaders">
        <h3 className="gs-title">{title}</h3>
        <EmptyState>{t.pickCompetition}</EmptyState>
      </WidgetFrame>
    );
  }
  const data = query.data;
  if (!data) {
    return (
      <WidgetFrame kind="competition_leaders" busy={query.loading}>
        <h3 className="gs-title">{title}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const columns: { key: 'appearances' | 'goals' | 'assists' | 'yellow' | 'red'; main: boolean }[] = [
    { key: 'appearances', main: false },
    ...(category === 'cards'
      ? [
          { key: 'yellow' as const, main: true },
          { key: 'red' as const, main: true },
        ]
      : [{ key: category === 'assists' ? ('assists' as const) : ('goals' as const), main: true }]),
  ];
  const value = (r: GsLeaders['data'][number], key: (typeof columns)[number]['key']) =>
    key === 'yellow' ? r.yellow_cards : key === 'red' ? r.red_cards : r[key];
  return (
    <WidgetFrame kind="competition_leaders">
      <header className="gs-header">
        <h3 className="gs-title gs-truncate">{title}</h3>
        <span className="gs-spacer" />
        <span>{data.season.label}</span>
      </header>
      {data.data.length === 0 ? (
        <EmptyState>{t.emptyLeaders}</EmptyState>
      ) : (
        <table className="gs-table" data-gs-leaders={category}>
          <thead>
            <tr>
              <th className="gs-left" scope="col">
                #
              </th>
              <th className="gs-left" scope="col">
                {t.player}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" title={t.full[c.key]}>
                  <abbr title={t.full[c.key]}>{t.short[c.key]}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((r, i) => (
              <tr key={r.person.id} data-gs-person={r.person.id}>
                <td className="gs-left gs-rank">{data.data[i - 1]?.rank === r.rank ? '' : r.rank}</td>
                <td className="gs-left">
                  <span className="gs-person">
                    {r.person.photo ? (
                      <img
                        className="gs-person-photo"
                        src={r.person.photo}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <span className="gs-person-text">
                      <span className="gs-truncate gs-strong">{r.person.name}</span>
                      {r.team ? (
                        <span className="gs-line gs-small gs-muted">
                          <Crest src={r.team.logo} name={r.team.name} size="xs" />
                          <span className="gs-truncate">{r.team.name}</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={c.main ? 'gs-strong' : undefined}>
                    {value(r, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.updated_at ? (
        <footer className="gs-footer">
          <span>{fillText(t.updatedAt, { date: fmt.date(data.updated_at) })}</span>
        </footer>
      ) : null}
    </WidgetFrame>
  );
}
