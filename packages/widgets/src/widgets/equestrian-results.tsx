'use client';

import {
  eqScoreText,
  type GsEqCompetition,
  type GsEqCompetitionDetail,
  type GsEqResult,
  type GsPage,
} from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface EquestrianResultsProps {
  /** Id da prova (`/v1/equestrian/competitions/{id}`). Sem ele, a prova mais recente com classificação completa. */
  competitionId?: string | undefined;
  /** Quantos conjuntos listar (padrão 10; 0 = todos). */
  limit?: number | undefined;
  /** Nome do cavalo embaixo do cavaleiro (padrão: sim). */
  showHorse?: boolean | undefined;
  /** Faltas e tempo (padrão: sim). */
  showScore?: boolean | undefined;
  /** Prêmio publicado na classificação (padrão: não). */
  showPrize?: boolean | undefined;
}

const RESULTS_REFRESH_MS = 30 * 60_000;

/** Ordem da classificação: posição; sem posição (eliminado, desistiu) no fim. */
const byPosition = (a: GsEqResult, b: GsEqResult) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);

/**
 * Resultado de uma prova de salto: posição, cavaleiro com a bandeira, cavalo, faltas e tempo, como a
 * federação publicou (eliminados e desistentes no fim, com o código oficial).
 */
export function EquestrianResults({
  competitionId,
  limit = 10,
  showHorse = true,
  showScore = true,
  showPrize = false,
}: EquestrianResultsProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.equestrian;
  const latest = useGalaxieQuery<GsPage<GsEqCompetition>>(
    competitionId ? null : '/v1/equestrian/competitions',
    { full: 'true', limit: 1 },
    () => RESULTS_REFRESH_MS,
  );
  const id = competitionId || latest.data?.data[0]?.id || null;
  const detail = useGalaxieQuery<GsEqCompetitionDetail>(
    id ? `/v1/equestrian/competitions/${encodeURIComponent(id)}` : null,
    {},
    () => RESULTS_REFRESH_MS,
  );
  const fmt = useFormatters();
  const c = detail.data;
  if (!c) {
    const state = id ? detail : latest;
    const none = !id && latest.data !== null;
    return (
      <WidgetFrame kind="equestrian_results" busy={state.loading}>
        <h3 className="gs-title">{t.results}</h3>
        {none ? (
          <EmptyState>{t.empty}</EmptyState>
        ) : state.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const rows = [...c.standings].sort(byPosition);
  const shown = limit > 0 ? rows.slice(0, limit) : rows;
  return (
    <WidgetFrame kind="equestrian_results">
      <header className="gs-header">
        <h3 className="gs-title gs-truncate">{c.name}</h3>
        <span className="gs-spacer" />
        {c.level ? <span className="gs-tag">{c.level}</span> : null}
      </header>
      {shown.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <div className="gs-scroll">
          <table className="gs-table" data-gs-eq-results="">
            <thead>
              <tr>
                <th className="gs-left" scope="col">
                  #
                </th>
                <th className="gs-left" scope="col">
                  {t.combination}
                </th>
                {showScore ? <th scope="col">{t.faults}</th> : null}
                {showPrize ? <th scope="col">{t.prize}</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} data-gs-result={r.id}>
                  <td className="gs-left gs-rank">{r.position ?? r.position_raw ?? r.status}</td>
                  <td className="gs-left">
                    <div className="gs-line">
                      <Flag
                        url={r.country?.flag_url}
                        iso2={r.country?.iso2}
                        code={r.country?.code}
                        name={r.country?.name}
                      />
                      <span className="gs-truncate gs-strong">
                        {r.athlete?.name ?? r.athlete_name_as_published}
                      </span>
                    </div>
                    {showHorse && (r.horse || r.horse_name_as_published) ? (
                      <div className="gs-meta gs-small gs-truncate">
                        {r.horse?.name ?? r.horse_name_as_published}
                      </div>
                    ) : null}
                  </td>
                  {showScore ? (
                    <td>
                      {r.status === 'classified' || r.status === 'unknown' ? eqScoreText(r.score) : r.status}
                    </td>
                  ) : null}
                  {showPrize ? <td>{r.prize?.raw ?? '–'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="gs-footer">
        {c.date ? <time dateTime={c.date}>{fmt.date(`${c.date}T12:00:00Z`)}</time> : null}
        {c.venue ? (
          <span className="gs-truncate">{[c.venue, c.country?.name].filter(Boolean).join(', ')}</span>
        ) : null}
        {c.height_cm ? <span>{`${(c.height_cm / 100).toFixed(2)} m`}</span> : null}
      </footer>
    </WidgetFrame>
  );
}
