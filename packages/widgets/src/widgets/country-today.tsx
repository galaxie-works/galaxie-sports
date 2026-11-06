'use client';

import { fillText, type GsNocToday, type GsScheduleUnit } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  MedalDot,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
  useGamesSlug,
} from '../core/react.js';

export interface CountryTodayProps {
  /** Edição dos Jogos (`og-summer-2024`). Sem ela, a em andamento ou a última. */
  games?: string | undefined;
  /** País pelo código do COI (padrão BRA). */
  noc?: string | undefined;
  /** Medalhas conquistadas no dia (padrão: sim). */
  showMedals?: boolean | undefined;
  /** Só as provas que valem medalha (padrão: não). */
  medalOnly?: boolean | undefined;
}

const LIVE_REFRESH_MS = 60_000;
const DAY_REFRESH_MS = 15 * 60_000;

const MEDAL_KEY = { G: 'gold', S: 'silver', B: 'bronze' } as const;

/**
 * O dia do país nos Jogos ("Brasil hoje"): as provas com atletas dele, no horário do leitor, a ao vivo em
 * destaque, as que valem medalha marcadas e as medalhas já conquistadas no dia.
 */
export function CountryToday({
  games,
  noc = 'BRA',
  showMedals = true,
  medalOnly = false,
}: CountryTodayProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.olympics;
  const edition = useGamesSlug(games);
  const code = (noc || 'BRA').toUpperCase();
  const query = useGalaxieQuery<GsNocToday>(
    edition.slug
      ? `/v1/multisport/games/${encodeURIComponent(edition.slug)}/today/${encodeURIComponent(code)}`
      : null,
    {},
    (d) => (d.units.some((u) => u.status === 'live') ? LIVE_REFRESH_MS : DAY_REFRESH_MS),
  );
  const d = query.data;
  if (!d) {
    const state = edition.slug ? query : edition;
    return (
      <WidgetFrame kind="country_today" busy={state.loading}>
        <h3 className="gs-title">{fillText(t.today, { country: code })}</h3>
        {state.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const units = d.units
    .filter((u) => u.status !== 'cancelled' && (!medalOnly || u.is_medal_unit))
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
  const medals = showMedals ? d.medals.filter((m) => !m.revoked) : [];
  return (
    <WidgetFrame kind="country_today">
      <header className="gs-header">
        <Flag iso2={d.noc.iso2} code={d.noc.code} name={d.noc.name} />
        <h3 className="gs-title gs-truncate">{fillText(t.today, { country: d.noc.name })}</h3>
      </header>
      {medals.length ? (
        <div className="gs-group">
          <div className="gs-group-title">{t.medalsToday}</div>
          <ul className="gs-list">
            {medals.map((m) => (
              <li key={`${m.participant.id}-${m.event?.id ?? ''}`} className="gs-fixture">
                <MedalDot medal={m.medal} label={t[MEDAL_KEY[m.medal]]} />
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-truncate gs-strong">{m.participant.name}</span>
                  {m.event ? <span className="gs-meta gs-small gs-truncate">{m.event.name}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {units.length === 0 ? (
        <EmptyState>{fillText(t.noUnits, { country: d.noc.name })}</EmptyState>
      ) : (
        <UnitList units={units} medalLabel={t.medalEvent} />
      )}
    </WidgetFrame>
  );
}

function UnitList({ units, medalLabel }: { units: GsScheduleUnit[]; medalLabel: string }) {
  const fmt = useFormatters();
  const { texts } = useGalaxieWidget();
  return (
    <ul className="gs-list">
      {units.map((u) => (
        <li
          key={u.id}
          className="gs-fixture"
          data-gs-unit={u.id}
          data-live={u.status === 'live' || undefined}
        >
          <time className="gs-fixture-date" dateTime={u.starts_at ?? undefined}>
            {u.starts_at ? fmt.time(u.starts_at) : '–'}
          </time>
          <span className="gs-grow" style={{ minWidth: 0 }}>
            <span className="gs-line">
              <span className="gs-truncate gs-strong">{u.event.discipline?.name ?? u.event.name}</span>
              {u.is_medal_unit ? <span className="gs-tag">{medalLabel}</span> : null}
            </span>
            <span className="gs-meta gs-small gs-truncate">
              {[u.event.name, u.name ?? u.phase.name].filter(Boolean).join(' · ')}
            </span>
          </span>
          {u.status === 'live' ? (
            <span className="gs-badge" data-tone="live">
              {texts.status.live}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
