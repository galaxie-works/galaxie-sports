'use client';

import {
  fillText,
  isoDate,
  localTimeZone,
  type GsEvent,
  type GsEventList,
  type GsRaceCareer,
  type GsTeam,
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

export interface AthleteProfileProps {
  /** Id do piloto, da equipe (F1) ou do lutador (MMA) na API Galaxie. */
  teamId: string;
  /** Números da carreira (padrão: sim). */
  showCareer?: boolean | undefined;
  /** F1: a temporada atual (posição, pontos, vitórias). MMA: a próxima luta. Padrão: sim. */
  showCurrent?: boolean | undefined;
  /** MMA: quantas lutas recentes listar (padrão 5; 0 esconde). */
  recent?: number | undefined;
}

const PROFILE_REFRESH_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Lutas dos últimos 6 anos (o cartel do período) e a próxima, até 6 meses à frente. */
const FIGHT_PAST_DAYS = 6 * 365;
const FIGHT_AHEAD_DAYS = 180;

/**
 * Perfil do atleta: na F1, o piloto (ou a equipe) com o retrato, a temporada atual e os números da carreira;
 * no MMA, o lutador com o cartel, a próxima luta e as últimas, com o método e o round.
 */
export function AthleteProfile({
  teamId,
  showCareer = true,
  showCurrent = true,
  recent = 5,
}: AthleteProfileProps) {
  const team = useGalaxieQuery<GsTeam>(
    teamId ? `/v1/teams/${encodeURIComponent(teamId)}` : null,
    {},
    () => PROFILE_REFRESH_MS,
  );
  const p = team.data;
  if (!p) {
    return (
      <WidgetFrame kind="athlete_profile" busy={team.loading}>
        {team.loading ? <LoadingState lines={5} /> : <ErrorState error={team.error} onRetry={team.retry} />}
      </WidgetFrame>
    );
  }
  return p.sport === 'formula-1' ? (
    <RacingProfile team={p} showCareer={showCareer} showCurrent={showCurrent} />
  ) : (
    <FighterProfile team={p} showCareer={showCareer} showCurrent={showCurrent} recent={recent} />
  );
}

function Head({
  team,
  photo,
  subtitle,
}: {
  team: GsTeam;
  photo?: string | null | undefined;
  subtitle?: string | null | undefined;
}) {
  return (
    <header className="gs-profile">
      <Crest src={photo ?? team.logo} name={team.name} size="lg" />
      <div className="gs-grow" style={{ minWidth: 0 }}>
        <h3 className="gs-title gs-truncate">{team.name}</h3>
        <div className="gs-line gs-meta">
          {team.country_ref?.flag ? (
            <Crest src={team.country_ref.flag} name={team.country_ref.name} size="xs" />
          ) : null}
          <span className="gs-truncate">
            {[team.country_ref?.name, subtitle].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
    </header>
  );
}

function Stats({ items }: { items: [string, string | number | null][] }) {
  const shown = items.filter(([, v]) => v !== null);
  return shown.length ? (
    <div className="gs-stats">
      {shown.map(([label, value]) => (
        <div key={label} className="gs-stat">
          <strong>{value}</strong>
          <span className="gs-muted gs-small">{label}</span>
        </div>
      ))}
    </div>
  ) : null;
}

function RacingProfile({
  team,
  showCareer,
  showCurrent,
}: {
  team: GsTeam;
  showCareer: boolean;
  showCurrent: boolean;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.racing;
  const career = useGalaxieQuery<GsRaceCareer>(
    `/v1/teams/${encodeURIComponent(team.id)}/career`,
    {},
    () => PROFILE_REFRESH_MS,
  );
  const c = career.data;
  const current = c?.current_season ? c.seasons.find((s) => s.year === c.current_season) : undefined;
  const teamNow = c?.teams[c.teams.length - 1];
  const number = c?.profile?.number;
  return (
    <WidgetFrame kind="athlete_profile" busy={career.loading}>
      <Head
        team={team}
        photo={c?.portrait?.url}
        subtitle={[number ? `#${number}` : null, c?.kind === 'driver' ? teamNow?.name : null]
          .filter(Boolean)
          .join(' · ')}
      />
      {!c ? (
        career.loading ? (
          <LoadingState lines={3} />
        ) : null
      ) : (
        <>
          {showCurrent && current ? (
            <div className="gs-group">
              <div className="gs-group-title">{fillText(t.season, { year: current.year })}</div>
              <Stats
                items={[
                  [t.position, current.position ? `${current.position}º` : null],
                  [t.points, current.points],
                  [t.wins, current.wins],
                  [t.podiums, current.podiums],
                ]}
              />
            </div>
          ) : null}
          {showCareer ? (
            <div className="gs-group">
              <div className="gs-group-title">{t.career}</div>
              <Stats
                items={[
                  [t.titles, c.titles.length],
                  [t.races, c.totals.races],
                  [t.wins, c.totals.wins],
                  [t.podiums, c.totals.podiums],
                  [t.poles, c.totals.poles],
                ]}
              />
              {c.titles.length ? <span className="gs-muted gs-small">{c.titles.join(' · ')}</span> : null}
            </div>
          ) : null}
        </>
      )}
    </WidgetFrame>
  );
}

/** Desfecho da luta do ponto de vista do lutador. */
function outcome(e: GsEvent, id: string): 'W' | 'L' | 'D' | null {
  if (e.status !== 'finished') return null;
  const me = e.participants.find((p) => p.id === id);
  if (me?.winner === true) return 'W';
  if (me?.winner === false) return 'L';
  return e.fight?.result ? 'D' : null;
}

function FighterProfile({
  team,
  showCareer,
  showCurrent,
  recent,
}: {
  team: GsTeam;
  showCareer: boolean;
  showCurrent: boolean;
  recent: number;
}) {
  const { texts, timeZone } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.fights;
  const tz = timeZone ?? localTimeZone();
  const now = Date.now();
  const fights = useGalaxieQuery<GsEventList>(
    `/v1/teams/${encodeURIComponent(team.id)}/events`,
    {
      from: isoDate(new Date(now - FIGHT_PAST_DAYS * DAY_MS), tz),
      to: isoDate(new Date(now + FIGHT_AHEAD_DAYS * DAY_MS), tz),
      limit: 100,
    },
    () => PROFILE_REFRESH_MS,
  );
  const list = [...(fights.data?.data ?? [])]
    .filter((e) => e.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const results = list.map((e) => ({ e, r: outcome(e, team.id) })).filter((x) => x.r);
  const count = (r: 'W' | 'L' | 'D') => results.filter((x) => x.r === r).length;
  const next = list.find((e) => e.status === 'scheduled' || e.status === 'live' || e.status === 'starting');
  const opponent = (e: GsEvent) => e.participants.find((p) => p.id !== team.id);
  const last = results.slice(-Math.max(0, recent)).reverse();
  const weight = [...list].reverse().find((e) => e.fight?.weight_class)?.fight?.weight_class?.name;
  return (
    <WidgetFrame kind="athlete_profile" busy={fights.loading}>
      <Head team={team} subtitle={weight} />
      {!fights.data ? (
        fights.loading ? (
          <LoadingState lines={3} />
        ) : (
          <ErrorState error={fights.error} onRetry={fights.retry} />
        )
      ) : (
        <>
          {showCareer ? (
            <div className="gs-group">
              <div className="gs-group-title">{t.record}</div>
              <Stats
                items={[
                  [t.win, count('W')],
                  [t.loss, count('L')],
                  [t.draw, count('D')],
                ]}
              />
            </div>
          ) : null}
          {showCurrent && next ? (
            <div className="gs-group">
              <div className="gs-group-title">{texts.racing.next}</div>
              <div className="gs-line">
                <Crest src={opponent(next)?.logo} name={opponent(next)?.name ?? '?'} size="xs" />
                <span className="gs-truncate">
                  {fillText(t.versus, { name: opponent(next)?.name ?? '?' })}
                </span>
                <span className="gs-spacer" />
                <time className="gs-muted gs-small" dateTime={next.starts_at}>
                  {fmt.dayMonth(next.starts_at)}
                </time>
              </div>
              {next.fight?.card ? <span className="gs-muted gs-small">{next.fight.card.name}</span> : null}
            </div>
          ) : null}
          {last.length ? (
            <div className="gs-group">
              <div className="gs-group-title">{t.lastFights}</div>
              <ul className="gs-list">
                {last.map(({ e, r }) => {
                  const res = e.fight?.result;
                  const how = [
                    res?.method_name,
                    res?.round
                      ? fillText(t.roundTime, { round: res.round, time: res.time ?? '' }).replace(/ · $/, '')
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li key={e.id} className="gs-fixture" data-gs-event={e.id}>
                      <time className="gs-fixture-date" dateTime={e.starts_at}>
                        {fmt.date(e.starts_at)}
                      </time>
                      <span className="gs-grow" style={{ minWidth: 0 }}>
                        <span className="gs-truncate">
                          {fillText(t.versus, { name: opponent(e)?.name ?? '?' })}
                        </span>
                        {how ? <span className="gs-line gs-meta gs-truncate">{how}</span> : null}
                      </span>
                      <span className="gs-result" data-r={r}>
                        {r === 'W' ? t.win : r === 'L' ? t.loss : t.draw}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : results.length === 0 && !next ? (
            <EmptyState>{texts.schedule.empty}</EmptyState>
          ) : null}
        </>
      )}
    </WidgetFrame>
  );
}
