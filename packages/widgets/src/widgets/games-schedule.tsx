'use client';

import { isoDate, type GsGames, type GsPage, type GsScheduleUnit } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
  useGamesSlug,
} from '../core/react.js';

export interface GamesScheduleProps {
  /** Edição dos Jogos (`og-summer-2024`). Sem ela, a em andamento ou a última. */
  games?: string | undefined;
  /** Só as provas que valem medalha (padrão: não). */
  medalOnly?: boolean | undefined;
  /** Quantas provas (padrão 20). */
  limit?: number | undefined;
  /** Local da prova (padrão: sim). */
  showVenue?: boolean | undefined;
}

const LIVE_REFRESH_MS = 60_000;
const DAY_REFRESH_MS = 15 * 60_000;
const DETAIL_REFRESH_MS = 6 * 60 * 60_000;

/** Dia da programação: hoje no fuso da sede durante os Jogos; antes, o 1º dia; depois, o último. */
function scheduleDay(g: GsGames, now: Date): string {
  const today = isoDate(now, g.tz);
  if (today < g.start_date) return g.start_date;
  if (today > g.end_date) return g.end_date;
  return today;
}

/**
 * Programação do dia dos Jogos: as provas de todas as modalidades no horário do leitor, a fase, o local,
 * a ao vivo em destaque e as que valem medalha marcadas.
 */
export function GamesSchedule({
  games,
  medalOnly = false,
  limit = 20,
  showVenue = true,
}: GamesScheduleProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.olympics;
  const edition = useGamesSlug(games);
  const detail = useGalaxieQuery<GsGames>(
    edition.slug ? `/v1/multisport/games/${encodeURIComponent(edition.slug)}` : null,
    {},
    () => DETAIL_REFRESH_MS,
  );
  const g = detail.data;
  const day = g ? scheduleDay(g, new Date()) : undefined;
  const query = useGalaxieQuery<GsPage<GsScheduleUnit>>(
    g ? `/v1/multisport/games/${encodeURIComponent(g.slug)}/schedule` : null,
    { date: day, medal_only: medalOnly ? 'true' : undefined, limit: Math.min(100, Math.max(1, limit)) },
    (list) => (list.data.some((u) => u.status === 'live') ? LIVE_REFRESH_MS : DAY_REFRESH_MS),
  );
  if (!g || !query.data) {
    const state = !edition.slug ? edition : !g ? detail : query;
    return (
      <WidgetFrame kind="games_schedule" busy={state.loading}>
        <h3 className="gs-title">{t.schedule}</h3>
        {state.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const units = query.data.data
    .filter((u) => u.status !== 'cancelled')
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
  return (
    <WidgetFrame kind="games_schedule">
      <header className="gs-header">
        <h3 className="gs-title gs-truncate">{`${t.schedule} · ${g.name}`}</h3>
        <span className="gs-spacer" />
        {day ? <time dateTime={day}>{fmt.dayMonth(`${day}T12:00:00Z`)}</time> : null}
      </header>
      {units.length === 0 ? (
        <EmptyState>{t.emptySchedule}</EmptyState>
      ) : (
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
                  {u.is_medal_unit ? <span className="gs-tag">{t.medalEvent}</span> : null}
                </span>
                <span className="gs-meta gs-small gs-truncate">
                  {[u.event.name, u.name ?? u.phase.name, showVenue ? u.venue : null]
                    .filter(Boolean)
                    .join(' · ')}
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
      )}
    </WidgetFrame>
  );
}
