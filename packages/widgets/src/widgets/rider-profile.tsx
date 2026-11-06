'use client';

import {
  eqScoreText,
  type GsEqAthlete,
  type GsEqOverview,
  type GsEqResult,
  type GsPage,
} from '../core/model.js';
import {
  ErrorState,
  Flag,
  LoadingState,
  StatGrid,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface RiderProfileProps {
  /** Id do cavaleiro (`/v1/equestrian/athletes/{id}`). Sem ele, o destaque do momento. */
  athleteId?: string | undefined;
  /** Cavalos com que mais competiu (padrão 3; 0 esconde). */
  horses?: number | undefined;
  /** Últimos resultados (padrão 5; 0 esconde). */
  recent?: number | undefined;
  /** Posição nos rankings observados (padrão: sim). */
  showRankings?: boolean | undefined;
}

const PROFILE_REFRESH_MS = 60 * 60_000;

/** Perfil do cavaleiro: país, números da carreira na base, os cavalos, o ranking e os últimos resultados. */
export function RiderProfile({ athleteId, horses = 3, recent = 5, showRankings = true }: RiderProfileProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.equestrian;
  const overview = useGalaxieQuery<GsEqOverview>(
    athleteId ? null : '/v1/equestrian/overview',
    {},
    () => PROFILE_REFRESH_MS,
  );
  const id = athleteId || overview.data?.highlights[0]?.id || null;
  const athlete = useGalaxieQuery<GsEqAthlete>(
    id ? `/v1/equestrian/athletes/${encodeURIComponent(id)}` : null,
    {},
    () => PROFILE_REFRESH_MS,
  );
  const results = useGalaxieQuery<GsPage<GsEqResult>>(
    id && recent > 0 ? '/v1/equestrian/results' : null,
    { athlete: id ?? undefined, limit: recent },
    () => PROFILE_REFRESH_MS,
  );
  const a = athlete.data;
  if (!a) {
    const state = id ? athlete : overview;
    return (
      <WidgetFrame kind="rider_profile" busy={state.loading}>
        {state.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const ranking = showRankings ? a.rankings.find((r) => r.rank != null) : undefined;
  const topHorses = [...a.horses].sort((x, y) => y.results - x.results).slice(0, Math.max(0, horses));
  return (
    <WidgetFrame kind="rider_profile">
      <header className="gs-profile">
        <div className="gs-grow" style={{ minWidth: 0 }}>
          <h3 className="gs-title gs-truncate">{a.name}</h3>
          <div className="gs-line gs-meta">
            <Flag
              url={a.country?.flag_url}
              iso2={a.country?.iso2}
              code={a.country?.code}
              name={a.country?.name}
            />
            <span className="gs-truncate">{a.country?.name ?? a.country?.code}</span>
          </div>
        </div>
        {ranking ? <span className="gs-tag">{`${ranking.rank}º · ${ranking.ranking}`}</span> : null}
      </header>
      <StatGrid
        items={[
          [t.starts, a.stats.results],
          [t.wins, a.stats.wins],
          [t.podiums, a.stats.podiums],
          [t.horses, a.horses.length],
        ]}
      />
      {topHorses.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.horses}</div>
          <ul className="gs-list">
            {topHorses.map((h) => (
              <li key={h.id} className="gs-fixture">
                <span className="gs-grow gs-truncate gs-strong">{h.name}</span>
                <span className="gs-meta gs-small">
                  {[h.breed, h.age ? `${h.age}a` : null].filter(Boolean).join(' · ')}
                </span>
                <span className="gs-muted">{h.results}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {recent > 0 && results.data?.data.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.recent}</div>
          <ul className="gs-list">
            {results.data.data.map((r) => (
              <li key={r.id} className="gs-fixture" data-gs-result={r.id}>
                <span className="gs-rank gs-strong">{r.position ?? r.status}</span>
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-truncate gs-strong">{r.competition?.name ?? '–'}</span>
                  <span className="gs-line gs-meta gs-small">
                    <span className="gs-truncate">
                      {[
                        r.horse?.name ?? r.horse_name_as_published,
                        r.date ? fmt.date(`${r.date}T12:00:00Z`) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </span>
                <span className="gs-muted gs-small">{eqScoreText(r.score)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </WidgetFrame>
  );
}
