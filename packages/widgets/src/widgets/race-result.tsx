'use client';

import { LIVE_STATUSES, eventRefreshMs, type GsEvent, type GsParticipant } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface RaceResultProps {
  /** Id da sessão (corrida, classificação, sprint ou treino) na API Galaxie. */
  eventId: string;
  /** Quantos pilotos listar (padrão: todos). */
  limit?: number | undefined;
  /** Coluna da equipe (padrão: sim). */
  showTeam?: boolean | undefined;
  /** Posição de largada (padrão: sim na corrida e na sprint). */
  showGrid?: boolean | undefined;
  /** Paradas nos boxes (padrão: não). */
  showPits?: boolean | undefined;
  /** Volta mais rápida embaixo da tabela (padrão: sim). */
  showFastestLap?: boolean | undefined;
}

/** Ordem da tabela: classificados pela posição; sem posição (abandono, desclassificado) no fim. */
function byPosition(a: GsParticipant, b: GsParticipant): number {
  return (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
}

/**
 * Resultado de uma sessão de F1: posição, piloto, equipe, tempo ou diferença para o líder, largada e a
 * volta mais rápida. Ao vivo, a ordem atual.
 */
export function RaceResult({
  eventId,
  limit,
  showTeam = true,
  showGrid,
  showPits = false,
  showFastestLap = true,
}: RaceResultProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.racing;
  const query = useGalaxieQuery<GsEvent>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}` : null,
    {},
    (event) => eventRefreshMs(event),
  );
  const event = query.data;
  if (!event) {
    return (
      <WidgetFrame kind="race_result" busy={query.loading}>
        <h3 className="gs-title">{t.result}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const session = event.session ?? null;
  const race = session?.type === 'race' || session?.type === 'sprint';
  const grid = showGrid ?? race;
  const drivers = [...event.participants].filter((p) => p.position != null || p.result).sort(byPosition);
  const shown = limit && limit > 0 ? drivers.slice(0, limit) : drivers;
  const fastest = session?.fastest_lap;
  const fastestDriver = fastest?.participant_id
    ? event.participants.find((p) => p.id === fastest.participant_id)
    : undefined;
  const title = [event.stage?.name, session?.name].filter(Boolean).join(' · ');
  return (
    <WidgetFrame kind="race_result">
      <header className="gs-header">
        {event.competition ? (
          <Crest src={event.competition.logo} name={event.competition.name} size="sm" />
        ) : null}
        <h3 className="gs-title gs-truncate">{title || t.result}</h3>
        <span className="gs-spacer" />
        <StatusBadge event={event} />
      </header>
      {shown.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <div className="gs-scroll">
          <table className="gs-table" data-gs-race="">
            <thead>
              <tr>
                <th className="gs-left" scope="col">
                  {t.position}
                </th>
                <th className="gs-left" scope="col">
                  {t.driver}
                </th>
                {showTeam ? (
                  <th className="gs-left" scope="col">
                    {t.team}
                  </th>
                ) : null}
                <th scope="col">{t.time}</th>
                {grid ? <th scope="col">{t.grid}</th> : null}
                {showPits ? <th scope="col">{t.pits}</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => {
                const r = p.result;
                // o líder mostra o tempo total; os outros, a diferença
                const time = i === 0 || !r?.gap ? (r?.time ?? '–') : r.gap;
                return (
                  <tr key={p.id} data-gs-participant={p.id}>
                    <td className="gs-left gs-rank">{p.position ?? '–'}</td>
                    <td className="gs-left">
                      <div className="gs-line">
                        <Crest src={p.photo?.url ?? p.logo} name={p.name} size="sm" />
                        <span className="gs-truncate">{p.name}</span>
                        {fastest?.participant_id === p.id ? (
                          <span className="gs-tag" title={t.fastestLap} aria-label={t.fastestLap}>
                            ⏱
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {showTeam ? (
                      <td className="gs-left">
                        {r?.team ? (
                          <div className="gs-line">
                            <Crest src={r.team.logo} name={r.team.name} size="xs" />
                            <span className="gs-truncate gs-muted">{r.team.name}</span>
                          </div>
                        ) : (
                          '–'
                        )}
                      </td>
                    ) : null}
                    <td className={i === 0 ? 'gs-strong' : undefined}>{time}</td>
                    {grid ? <td>{r?.grid ?? '–'}</td> : null}
                    {showPits ? <td>{r?.pits ?? '–'}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <footer className="gs-footer">
        <time dateTime={event.starts_at}>{fmt.dateTime(event.starts_at)}</time>
        {event.venue?.name ? <span className="gs-truncate">{event.venue.name}</span> : null}
        {showFastestLap && fastestDriver && fastest?.time && !LIVE_STATUSES.has(event.status) ? (
          <span className="gs-truncate">{`${t.fastestLap}: ${fastestDriver.name} ${fastest.time}`}</span>
        ) : null}
      </footer>
    </WidgetFrame>
  );
}
