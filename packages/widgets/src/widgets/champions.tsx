'use client';

import { type GsChampions, type GsTeamRef } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface ChampionsProps {
  /** Id ou slug do campeonato na API Galaxie. */
  competitionId: string;
  /** Quantas edições, das mais recentes (padrão 10; 0 = todas as guardadas). */
  limit?: number | undefined;
  /** Ranking de quem tem mais títulos (padrão: ligado; some quando a lista de campeões tem lacunas). */
  showRanking?: boolean | undefined;
  /** Vice de cada edição (padrão: desligado). */
  showRunnerUp?: boolean | undefined;
}

const REFRESH_MS = 24 * 60 * 60_000;
/** Times no ranking de títulos. */
const RANKING_SIZE = 5;

function TeamCell({ team, fallback }: { team: GsTeamRef | null; fallback: string }) {
  if (!team) return <span className="gs-muted">{fallback}</span>;
  return (
    <span className="gs-champion">
      <Crest src={team.logo} name={team.name} size="sm" />
      <span className="gs-truncate">{team.name}</span>
    </span>
  );
}

/** Quem ganhou cada edição do campeonato, ano a ano, e o resumo de quem tem mais títulos. */
export function Champions({
  competitionId,
  limit = 10,
  showRanking = true,
  showRunnerUp = false,
}: ChampionsProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.championship;
  const query = useGalaxieQuery<GsChampions>(
    competitionId ? `/v1/competitions/${encodeURIComponent(competitionId)}/champions` : null,
    { limit: limit > 0 ? Math.min(100, Math.round(limit)) : 100 },
    () => REFRESH_MS,
  );
  const header = <h3 className="gs-title">{t.champions}</h3>;
  if (!competitionId) {
    return (
      <WidgetFrame kind="champions">
        {header}
        <EmptyState>{t.pickCompetition}</EmptyState>
      </WidgetFrame>
    );
  }
  const data = query.data;
  if (!data) {
    return (
      <WidgetFrame kind="champions" busy={query.loading}>
        {header}
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  if (data.data.length === 0) {
    return (
      <WidgetFrame kind="champions">
        {header}
        <EmptyState>{t.emptyChampions}</EmptyState>
      </WidgetFrame>
    );
  }
  const ranking = data.ranking?.slice(0, RANKING_SIZE) ?? null;
  return (
    <WidgetFrame kind="champions">
      {header}
      {showRanking ? (
        ranking && ranking.length ? (
          <section className="gs-group" data-gs-ranking="">
            <h4 className="gs-group-title">{t.mostTitles}</h4>
            <table className="gs-table">
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.team.id} data-gs-team={r.team.id}>
                    <td className="gs-left">
                      <TeamCell team={r.team} fallback="" />
                    </td>
                    <td className="gs-strong" title={t.titles}>
                      {r.titles}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : data.ranking === null ? (
          <p className="gs-small gs-muted" data-gs-no-ranking="">
            {t.noRanking}
          </p>
        ) : null
      ) : null}
      <table className="gs-table" data-gs-champions="">
        <thead>
          <tr>
            <th className="gs-left" scope="col">
              {t.edition}
            </th>
            <th className="gs-left" scope="col">
              {t.champion}
            </th>
            {showRunnerUp ? (
              <th className="gs-left" scope="col">
                {t.runnerUp}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.data.map((e) => (
            <tr key={`${e.season_year}-${e.season_label}`} data-gs-edition={e.season_label}>
              <td className="gs-left">{e.season_label}</td>
              <td className="gs-left">
                <TeamCell team={e.champion} fallback={t.unidentified} />
              </td>
              {showRunnerUp ? (
                <td className="gs-left">
                  <TeamCell team={e.runner_up} fallback="—" />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </WidgetFrame>
  );
}
