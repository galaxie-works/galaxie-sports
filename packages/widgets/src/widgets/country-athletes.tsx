'use client';

import { fillText, type GsDelegation } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  MedalDot,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
  useGamesSlug,
} from '../core/react.js';

export interface CountryAthletesProps {
  /** Edição dos Jogos (`og-summer-2024`). Sem ela, a em andamento ou a última. */
  games?: string | undefined;
  /** País pelo código do COI (padrão BRA). */
  noc?: string | undefined;
  /** Só os medalhistas (padrão: não). */
  medalistsOnly?: boolean | undefined;
  /** Quantos atletas (padrão 20; 0 = todos). */
  limit?: number | undefined;
}

const REFRESH_MS = 30 * 60_000;
const MEDAL_KEY = { G: 'gold', S: 'silver', B: 'bronze' } as const;

/** Peso da medalha na ordem: ouro vale mais que qualquer número de pratas. */
const medalScore = (m: { gold: number; silver: number; bronze: number }) =>
  m.gold * 1_000_000 + m.silver * 1_000 + m.bronze;

/** Atletas do país na edição: os medalhistas primeiro, com as medalhas e as provas de cada um. */
export function CountryAthletes({
  games,
  noc = 'BRA',
  medalistsOnly = false,
  limit = 20,
}: CountryAthletesProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.olympics;
  const edition = useGamesSlug(games);
  const code = (noc || 'BRA').toUpperCase();
  const query = useGalaxieQuery<GsDelegation>(
    edition.slug
      ? `/v1/multisport/games/${encodeURIComponent(edition.slug)}/nocs/${encodeURIComponent(code)}/athletes`
      : null,
    {},
    () => REFRESH_MS,
  );
  const d = query.data;
  if (!d) {
    const state = edition.slug ? query : edition;
    return (
      <WidgetFrame kind="country_athletes" busy={state.loading}>
        <h3 className="gs-title">{fillText(t.athletes, { country: code })}</h3>
        {state.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const list = d.data
    .filter((a) => !medalistsOnly || a.medals.total > 0)
    .sort((a, b) => medalScore(b.medals) - medalScore(a.medals) || a.name.localeCompare(b.name));
  const shown = limit > 0 ? list.slice(0, limit) : list;
  return (
    <WidgetFrame kind="country_athletes">
      <header className="gs-header">
        <Flag iso2={d.noc.iso2} code={d.noc.code} name={d.noc.name} />
        <h3 className="gs-title gs-truncate">{fillText(t.athletes, { country: d.noc.name })}</h3>
      </header>
      {shown.length === 0 ? (
        <EmptyState>{t.noAthletes}</EmptyState>
      ) : (
        <ul className="gs-list">
          {shown.map((a) => {
            const won = a.events.filter((e) => e.medal);
            return (
              <li key={a.person_id} className="gs-fixture" data-gs-athlete={a.person_id}>
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-truncate gs-strong">{a.name}</span>
                  <span className="gs-meta gs-small gs-truncate">
                    {(won.length ? won : a.events).map((e) => e.name).join(' · ')}
                  </span>
                </span>
                <span className="gs-line">
                  {won.map((e) => (
                    <MedalDot key={e.id} medal={e.medal!} label={`${t[MEDAL_KEY[e.medal!]]} · ${e.name}`} />
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}
