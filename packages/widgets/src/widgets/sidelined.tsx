'use client';

import {
  fillText,
  type GsEventSidelined,
  type GsSidelinedPlayer,
  type GsSidelinedTeam,
  type GsTeamSidelined,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface SidelinedProps {
  /** Id do jogo na API Galaxie: os desfalques dos dois times. Tem precedência sobre `teamId`. */
  eventId?: string | undefined;
  /** Id do time: os desfalques atuais dele (e a lista do próximo jogo). */
  teamId?: string | undefined;
  /** Motivo (lesão, suspensão…) de cada jogador (padrão: sim). */
  showReason?: boolean | undefined;
  /** Previsão de volta, quando o fornecedor informa (padrão: sim). */
  showReturn?: boolean | undefined;
  /** Foto do jogador (padrão: sim). */
  showPhoto?: boolean | undefined;
  /** Jogadores em dúvida, além dos que estão fora (padrão: sim). */
  showDoubtful?: boolean | undefined;
  /** Máximo por time (padrão 10; 0 = todos). */
  limit?: number | undefined;
}

/** A lista do fornecedor sai no dia e o histórico muda pouco: 30 minutos. */
const REFRESH_MS = 30 * 60_000;

/** Data sem hora (YYYY-MM-DD) ao meio-dia UTC: o fuso do leitor não troca o dia. */
const noon = (d: string) => `${d}T12:00:00Z`;

/** Desfalques (lesionados, suspensos e dúvidas): por jogo, os dois times lado a lado; por time, a lista dele. */
export function Sidelined({
  eventId,
  teamId,
  showReason = true,
  showReturn = true,
  showPhoto = true,
  showDoubtful = true,
  limit = 10,
}: SidelinedProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.sidelined;
  const path = eventId
    ? `/v1/events/${encodeURIComponent(eventId)}/sidelined`
    : teamId
      ? `/v1/teams/${encodeURIComponent(teamId)}/sidelined`
      : null;
  const query = useGalaxieQuery<GsEventSidelined | GsTeamSidelined>(path, {}, () => REFRESH_MS);

  if (!path) {
    return (
      <WidgetFrame kind="sidelined">
        <h3 className="gs-title">{t.title}</h3>
        <EmptyState>{t.pick}</EmptyState>
      </WidgetFrame>
    );
  }
  if (!query.data) {
    return (
      <WidgetFrame kind="sidelined" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const max = Math.max(0, Math.round(limit) || 0);
  const pick = (players: GsSidelinedPlayer[]) => {
    const shown = showDoubtful ? players : players.filter((p) => p.status === 'out');
    return max > 0 ? shown.slice(0, max) : shown;
  };
  const groups: { team: GsSidelinedTeam; known: boolean; players: GsSidelinedPlayer[] }[] =
    'teams' in query.data
      ? query.data.teams.map((g) => ({
          team: g.team,
          known: g.available !== false,
          players: pick(g.players),
        }))
      : [{ team: query.data.team, known: true, players: pick(query.data.players) }];
  const unknown = !query.data.available;
  const byTeam = 'teams' in query.data;

  return (
    <WidgetFrame kind="sidelined">
      <header className="gs-header">
        {!byTeam && groups[0] ? (
          <Crest src={groups[0].team.logo} name={groups[0].team.name ?? ''} size="sm" />
        ) : null}
        <h3 className="gs-title gs-truncate">
          {!byTeam && groups[0]?.team.name ? `${t.title} · ${groups[0].team.name}` : t.title}
        </h3>
      </header>
      {unknown ? (
        <EmptyState>{t.unknown}</EmptyState>
      ) : (
        <div className="gs-sidelined" data-gs-sidelined={byTeam ? 'event' : 'team'}>
          {groups.map((g, i) => (
            <div className="gs-group" key={g.team.id ?? i}>
              {byTeam ? (
                <div className="gs-group-title">
                  <Crest src={g.team.logo} name={g.team.name ?? ''} size="xs" />
                  <span className="gs-truncate">{g.team.name}</span>
                </div>
              ) : null}
              {g.players.length === 0 ? (
                <span className="gs-muted gs-small">{g.known ? t.empty : t.unknown}</span>
              ) : (
                <ul className="gs-list">
                  {g.players.map((p, n) => (
                    <Absence
                      key={p.person.id ?? `${p.person.name}-${n}`}
                      player={p}
                      showReason={showReason}
                      showReturn={showReturn}
                      showPhoto={showPhoto}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}

function Absence({
  player,
  showReason,
  showReturn,
  showPhoto,
}: {
  player: GsSidelinedPlayer;
  showReason: boolean;
  showReturn: boolean;
  showPhoto: boolean;
}) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.sidelined;
  const reason = player.reason_label ?? t.category[player.category];
  const back = player.until ? fillText(t.until, { date: fmt.date(noon(player.until)) }) : t.noReturn;
  return (
    <li className="gs-fixture" data-gs-sidelined-player={player.person.id ?? ''} data-status={player.status}>
      {showPhoto ? <Crest src={player.person.photo} name={player.person.name} size="sm" /> : null}
      <span className="gs-sidelined-who">
        <span className="gs-line">
          {player.number !== null ? <span className="gs-muted gs-small">{player.number}</span> : null}
          <strong className="gs-truncate">{player.person.name}</strong>
        </span>
        {showReason || showReturn ? (
          <span className="gs-sidelined-why">
            {[showReason ? reason : null, showReturn ? back : null].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
      <span className="gs-badge" data-tone={player.status === 'out' ? 'live' : 'warn'}>
        {player.status === 'out' ? t.out : t.doubtful}
      </span>
    </li>
  );
}
