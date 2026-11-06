'use client';

import {
  LIVE_STATUSES,
  PROBLEM_STATUSES,
  STARTED_STATUSES,
  localized,
  type GsEvent,
  type GsTeamCompetition,
  type GsTeamOverview,
} from '../core/model.js';
import {
  Crest,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface TeamCardProps {
  /** Id do time na API Galaxie. */
  teamId: string;
  /** Forma recente: os últimos resultados com V/E/D (padrão: sim). */
  showForm?: boolean | undefined;
  /** Quantos jogos na forma (1 a 5, padrão 5). */
  formCount?: number | undefined;
  /** O próximo jogo, ou o jogo ao vivo agora (padrão: sim). */
  showNext?: boolean | undefined;
  /** Os campeonatos que o time disputa, com a situação em cada um (padrão: sim). */
  showCompetitions?: boolean | undefined;
  /** Quantos campeonatos listar (padrão 4; 0 = todos). */
  competitionsLimit?: number | undefined;
}

const LIVE_REFRESH_MS = 30_000;
const CARD_REFRESH_MS = 15 * 60_000;
/** A API manda os últimos 5 resultados. */
const FORM_MAX = 5;

/**
 * Cartão do time, para qualquer esporte com times: escudo, país e estádio, a forma recente (V/E/D), o próximo
 * jogo (ou o ao vivo) e os campeonatos que ele disputa, tudo de `/v1/teams/{id}/overview`.
 */
export function TeamCard({
  teamId,
  showForm = true,
  formCount = FORM_MAX,
  showNext = true,
  showCompetitions = true,
  competitionsLimit = 4,
}: TeamCardProps) {
  const { texts, locale } = useGalaxieWidget();
  const t = texts.teamCard;
  const query = useGalaxieQuery<GsTeamOverview>(
    teamId ? `/v1/teams/${encodeURIComponent(teamId)}/overview` : null,
    {},
    // 30 s só com jogo começando ou em andamento e com um bloco que muda com ele (próximo jogo ou forma)
    (o) => ((showNext || showForm) && hasActiveMatch(o) ? LIVE_REFRESH_MS : CARD_REFRESH_MS),
  );

  const o = query.data;
  if (!o) {
    return (
      <WidgetFrame kind="team_card" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const team = o.team;
  const name = team?.name ?? t.title;
  const place = [team?.country_ref?.name, team?.venue?.name].filter(Boolean).join(' · ');
  // a API manda do mais recente ao mais antigo; o cartão lê da esquerda (antigo) para a direita (último)
  const count = Math.min(FORM_MAX, Math.max(1, Math.round(formCount)));
  const form = o.form.slice(0, count).reverse();
  const upcoming = o.live_event ?? o.next_event ?? null;
  const competitions = pickCompetitions(o.competitions ?? [], competitionsLimit, locale);

  return (
    <WidgetFrame kind="team_card">
      <header className="gs-profile">
        <Crest src={team?.logo} name={name} size="lg" />
        <div className="gs-grow" style={{ minWidth: 0 }}>
          <h3 className="gs-title gs-truncate">{name}</h3>
          {place ? (
            <div className="gs-line gs-meta">
              {team?.country_ref?.flag ? (
                <Crest src={team.country_ref.flag} name={team.country_ref.name} size="xs" />
              ) : null}
              <span className="gs-truncate">{place}</span>
            </div>
          ) : null}
        </div>
      </header>

      {showForm && form.length ? (
        <div className="gs-group" data-gs-block="form">
          <div className="gs-group-title">{t.form}</div>
          <div className="gs-line" style={{ gap: 4 }} aria-label={t.form}>
            {form.map((f) => (
              <span
                key={f.event_id}
                className="gs-result"
                data-r={f.result}
                title={[texts.schedule.result[f.result], f.score].filter(Boolean).join(' · ')}
              >
                {texts.schedule.result[f.result]}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showNext ? (
        <div className="gs-group" data-gs-block="next">
          <div className="gs-group-title">
            {upcoming && LIVE_STATUSES.has(upcoming.status) ? t.live : t.next}
          </div>
          {upcoming ? (
            <ul className="gs-list">
              <NextMatch event={upcoming} teamId={team?.id ?? teamId} />
            </ul>
          ) : (
            <span className="gs-muted gs-small">{t.noNext}</span>
          )}
        </div>
      ) : null}

      {showCompetitions && competitions.length ? (
        <div className="gs-group" data-gs-block="competitions">
          <div className="gs-group-title">{t.competitions}</div>
          <ul className="gs-list">
            {competitions.map((c) => (
              <li
                key={`${c.competition.id}-${c.season.year}`}
                className="gs-fixture"
                data-gs-competition={c.competition.id}
              >
                <Crest src={c.competition.logo} name={c.competition.name} size="xs" />
                <span className="gs-grow gs-truncate">{c.competition.name}</span>
                <span className="gs-muted gs-small gs-truncate" style={{ maxWidth: '55%' }}>
                  {localized(c.campaign.label, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

/** Jogo ao vivo, ou o próximo já começando (`starting` vem em `next_event`) ou em andamento. */
export function hasActiveMatch(o: GsTeamOverview): boolean {
  const next = o.next_event;
  return !!o.live_event || (!!next && (LIVE_STATUSES.has(next.status) || next.status === 'starting'));
}

/**
 * Os campeonatos mostrados: os primeiros na ordem da API (em disputa primeiro, depois o mais recente) até o
 * limite, e então em ordem alfabética para ler.
 */
export function pickCompetitions(
  list: GsTeamCompetition[],
  limit: number,
  locale: string,
): GsTeamCompetition[] {
  const shown = limit > 0 ? list.slice(0, limit) : [...list];
  return shown.sort((a, b) =>
    a.competition.name.localeCompare(b.competition.name, locale, { sensitivity: 'base' }),
  );
}

function NextMatch({ event, teamId }: { event: GsEvent; teamId: string }) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.schedule;
  const me = event.participants.find((p) => p.id === teamId);
  const rival = event.participants.find((p) => p.id !== teamId);
  if (!rival) return null;
  const home = me ? me.side === 'home' : true;
  const started = STARTED_STATUSES.has(event.status);
  const live = LIVE_STATUSES.has(event.status);
  const mine = home ? event.score.home : event.score.away;
  const theirs = home ? event.score.away : event.score.home;
  return (
    <li
      className="gs-fixture"
      data-gs-event={event.id}
      data-live={live || undefined}
      // a faixa do ao vivo (sombra à esquerda) não encosta na data
      style={live ? { paddingLeft: 10 } : undefined}
    >
      <time className="gs-fixture-date" dateTime={event.starts_at}>
        {fmt.dayMonth(event.starts_at)}
        {!started ? ` · ${fmt.time(event.starts_at)}` : null}
      </time>
      <span className="gs-grow" style={{ minWidth: 0 }}>
        <span className="gs-line">
          <Crest src={rival.logo} name={rival.name} size="xs" />
          <span className="gs-truncate">{rival.short_name ?? rival.name}</span>
          <span className="gs-muted gs-small">{home ? t.home : t.away}</span>
        </span>
        {event.competition ? (
          <span className="gs-line gs-meta">
            <span className="gs-truncate">
              {[event.competition.name, event.stage?.name].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : null}
      </span>
      {started && mine !== null && theirs !== null ? (
        <span className="gs-line-score">
          {mine} – {theirs}
        </span>
      ) : null}
      {live || PROBLEM_STATUSES.has(event.status) ? <StatusBadge event={event} /> : null}
    </li>
  );
}
