'use client';

import { isoDate, localTimeZone, type GsEqCompetition, type GsPage } from '../core/model.js';
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

export interface EquestrianCalendarProps {
  /** `upcoming` = próximas provas (sem nenhuma, as últimas); `recent` = as últimas. Padrão: upcoming. */
  range?: 'upcoming' | 'recent' | undefined;
  /** Quantas provas (padrão 8). */
  limit?: number | undefined;
  /** Só os Grandes Prêmios (padrão: não). */
  grandPrixOnly?: boolean | undefined;
  /** Local da prova (padrão: sim). */
  showVenue?: boolean | undefined;
}

const CALENDAR_REFRESH_MS = 60 * 60_000;

/** Dia de uma data ISO (sem hora) no formato do leitor: meio-dia UTC não troca de dia em nenhum fuso. */
const noon = (d: string) => `${d}T12:00:00Z`;

/**
 * Calendário de provas de salto: data, prova com o nível (CSI5*, CSIO…) e o local com a bandeira. As
 * próximas, em ordem; sem próximas na base, as últimas disputadas.
 */
export function EquestrianCalendar({
  range = 'upcoming',
  limit = 8,
  grandPrixOnly = false,
  showVenue = true,
}: EquestrianCalendarProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.equestrian;
  const today = isoDate(new Date(), timeZone ?? localTimeZone());
  const size = Math.min(100, Math.max(1, grandPrixOnly ? limit * 4 : limit));
  const upcoming = useGalaxieQuery<GsPage<GsEqCompetition>>(
    range === 'upcoming' ? '/v1/equestrian/competitions' : null,
    { from: today, limit: 100 },
    () => CALENDAR_REFRESH_MS,
  );
  const future = (upcoming.data?.data ?? []).filter((c) => !grandPrixOnly || c.is_grand_prix);
  const needRecent = range === 'recent' || (upcoming.data !== null && future.length === 0);
  const recent = useGalaxieQuery<GsPage<GsEqCompetition>>(
    needRecent ? '/v1/equestrian/competitions' : null,
    { to: today, limit: size },
    () => CALENDAR_REFRESH_MS,
  );
  const state = needRecent ? recent : upcoming;
  if (!state.data) {
    return (
      <WidgetFrame kind="equestrian_calendar" busy={state.loading}>
        <h3 className="gs-title">{t.calendar}</h3>
        {state.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  // a API devolve da mais nova para a mais antiga: as próximas em ordem de data
  const list = needRecent
    ? (recent.data?.data ?? []).filter((c) => !grandPrixOnly || c.is_grand_prix)
    : [...future].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const items = list.slice(0, limit > 0 ? limit : undefined);
  return (
    <WidgetFrame kind="equestrian_calendar">
      <h3 className="gs-title">{t.calendar}</h3>
      {items.length === 0 ? (
        <EmptyState>{t.emptyCalendar}</EmptyState>
      ) : (
        <ul className="gs-list">
          {items.map((c, i) => (
            <li
              key={c.id}
              className="gs-fixture"
              data-gs-eq-competition={c.id}
              data-next={(!needRecent && i === 0) || undefined}
            >
              <time className="gs-fixture-date" dateTime={c.date ?? undefined}>
                {c.date ? fmt.date(noon(c.date)) : '–'}
              </time>
              <span className="gs-grow" style={{ minWidth: 0 }}>
                <span className="gs-line">
                  <span className="gs-truncate gs-strong">{c.name}</span>
                  {c.is_grand_prix ? <span className="gs-tag">{t.grandPrix}</span> : null}
                </span>
                {showVenue && (c.venue || c.country) ? (
                  <span className="gs-line gs-meta">
                    <Flag
                      url={c.country?.flag_url}
                      iso2={c.country?.iso2}
                      code={c.country?.code}
                      name={c.country?.name}
                    />
                    <span className="gs-truncate">
                      {[c.venue, c.country?.name].filter(Boolean).join(', ')}
                    </span>
                  </span>
                ) : null}
              </span>
              {c.level ? <span className="gs-tag">{c.level}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
