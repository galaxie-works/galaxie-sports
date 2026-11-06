'use client';

import { type GsEqRanking, type GsPage } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface EquestrianRankingProps {
  /** Quantos conjuntos por ranking (padrão 10). */
  limit?: number | undefined;
  /** Nome do cavalo embaixo do cavaleiro, quando o ranking é do conjunto (padrão: sim). */
  showHorse?: boolean | undefined;
  /** Pontos (padrão: sim). */
  showPoints?: boolean | undefined;
}

const RANKING_REFRESH_MS = 6 * 60 * 60_000;

/**
 * Rankings observados do hipismo (Longines e afins), na ordem publicada: posição, cavaleiro com a bandeira,
 * o cavalo e os pontos, um bloco por ranking.
 */
export function EquestrianRanking({
  limit = 10,
  showHorse = true,
  showPoints = true,
}: EquestrianRankingProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.equestrian;
  const query = useGalaxieQuery<GsPage<GsEqRanking>>('/v1/equestrian/rankings', {}, () => RANKING_REFRESH_MS);
  if (!query.data) {
    return (
      <WidgetFrame kind="equestrian_ranking" busy={query.loading}>
        <h3 className="gs-title">{t.ranking}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const groups = new Map<string, GsEqRanking[]>();
  for (const r of query.data.data) groups.set(r.ranking, [...(groups.get(r.ranking) ?? []), r]);
  return (
    <WidgetFrame kind="equestrian_ranking">
      <h3 className="gs-title">{t.ranking}</h3>
      {groups.size === 0 ? (
        <EmptyState>{t.emptyRanking}</EmptyState>
      ) : (
        [...groups].map(([name, rows]) => {
          const sorted = [...rows].sort(
            (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
          );
          const edition = sorted.find((r) => r.edition)?.edition;
          return (
            <div key={name} className="gs-group">
              <div className="gs-group-title">{[name, edition].filter(Boolean).join(' · ')}</div>
              <table className="gs-table" data-gs-eq-ranking="">
                <tbody>
                  {sorted.slice(0, limit > 0 ? limit : undefined).map((r) => (
                    <tr key={r.id}>
                      <td className="gs-left gs-rank">{r.rank ?? '–'}</td>
                      <td className="gs-left">
                        <div className="gs-line">
                          <Flag
                            url={r.athlete?.country?.flag_url}
                            iso2={r.athlete?.country?.iso2}
                            code={r.athlete?.country?.code}
                            name={r.athlete?.country?.name}
                          />
                          <span className="gs-truncate gs-strong">{r.athlete?.name ?? '–'}</span>
                        </div>
                        {showHorse && (r.horse || r.horse_name_as_published) ? (
                          <div className="gs-meta gs-small gs-truncate">
                            {r.horse?.name ?? r.horse_name_as_published}
                          </div>
                        ) : null}
                      </td>
                      {showPoints ? <td className="gs-strong">{r.points ?? '–'}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </WidgetFrame>
  );
}
