'use client';

import { fillText, type GsEqHorse, type GsEqResult, type GsPage } from '../core/model.js';
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

export interface HorseProfileProps {
  /** Id do cavalo (`/v1/equestrian/horses/{id}`). Sem ele, o cavalo com mais provas na base. */
  horseId?: string | undefined;
  /** Pai, mãe e avô materno (padrão: sim). */
  showPedigree?: boolean | undefined;
  /** Cavaleiros que o montaram (padrão: sim). */
  showRiders?: boolean | undefined;
  /** Últimos resultados (padrão 5; 0 esconde). */
  recent?: number | undefined;
}

const PROFILE_REFRESH_MS = 60 * 60_000;

/** Perfil do cavalo: raça, idade, sexo e pelagem, o pedigree, os números, quem o monta e os últimos resultados. */
export function HorseProfile({
  horseId,
  showPedigree = true,
  showRiders = true,
  recent = 5,
}: HorseProfileProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.equestrian;
  const top = useGalaxieQuery<GsPage<{ id: string }>>(
    horseId ? null : '/v1/equestrian/horses',
    { detailed: 'true', limit: 1 },
    () => PROFILE_REFRESH_MS,
  );
  const id = horseId || top.data?.data[0]?.id || null;
  const horse = useGalaxieQuery<GsEqHorse>(
    id ? `/v1/equestrian/horses/${encodeURIComponent(id)}` : null,
    {},
    () => PROFILE_REFRESH_MS,
  );
  const results = useGalaxieQuery<GsPage<GsEqResult>>(
    id && recent > 0 ? '/v1/equestrian/results' : null,
    { horse: id ?? undefined, limit: recent },
    () => PROFILE_REFRESH_MS,
  );
  const h = horse.data;
  if (!h) {
    const state = id ? horse : top;
    return (
      <WidgetFrame kind="horse_profile" busy={state.loading}>
        {state.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const gender = h.gender && h.gender in t.gender ? t.gender[h.gender as keyof typeof t.gender] : h.gender;
  const pedigree: [string, string | null][] = [
    [t.sire, h.sire],
    [t.dam, h.dam],
    [t.damSire, h.dam_sire],
  ];
  return (
    <WidgetFrame kind="horse_profile">
      <header className="gs-profile">
        <div className="gs-grow" style={{ minWidth: 0 }}>
          <h3 className="gs-title gs-truncate">{h.name}</h3>
          <div className="gs-meta gs-truncate">
            {[h.breed ?? h.studbook, h.age ? fillText(t.age, { age: h.age }) : null, gender, h.color]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </header>
      <StatGrid
        items={[
          [t.starts, h.stats.results],
          [t.wins, h.stats.wins],
          [t.podiums, h.stats.podiums],
          [t.riders, h.riders.length],
        ]}
      />
      {showPedigree && pedigree.some(([, v]) => v) ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.pedigree}</div>
          <dl className="gs-list" data-gs-pedigree="">
            {pedigree
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="gs-fixture">
                  <dt className="gs-muted gs-small">{label}</dt>
                  <dd className="gs-grow gs-truncate gs-strong" style={{ margin: 0 }}>
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      ) : null}
      {showRiders && h.riders.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.riders}</div>
          <ul className="gs-list">
            {[...h.riders]
              .sort((a, b) => b.results - a.results)
              .slice(0, 4)
              .map((r) => (
                <li key={r.id} className="gs-fixture">
                  <Flag
                    url={r.country?.flag_url}
                    iso2={r.country?.iso2}
                    code={r.country?.code}
                    name={r.country?.name}
                  />
                  <span className="gs-grow gs-truncate gs-strong">{r.name}</span>
                  <span className="gs-muted">{r.results}</span>
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
                  <span className="gs-meta gs-small gs-truncate">
                    {[
                      r.athlete?.name ?? r.athlete_name_as_published,
                      r.date ? fmt.date(`${r.date}T12:00:00Z`) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </WidgetFrame>
  );
}
