'use client';

import { SQUAD_POSITIONS, fillText, pluralText, type GsPersonOverview } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  StatGrid,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface PlayerProfileProps {
  /** Id do jogador (ou técnico) na API Galaxie (`/v1/people/{id}`). */
  personId: string;
  /** Ano da temporada dos números (padrão: a mais recente com jogos). */
  season?: number | undefined;
  /** Números da temporada: jogos, gols, assistências, minutos, cartões e nota (padrão: sim). */
  showStats?: boolean | undefined;
  /** Clubes por onde passou, do atual ao primeiro (padrão: sim). */
  showClubs?: boolean | undefined;
  /** Jogos e gols em cada temporada (padrão: sim). */
  showSeasons?: boolean | undefined;
  /** Títulos e colocações (padrão: sim). */
  showTrophies?: boolean | undefined;
  /** Transferências (padrão: sim). */
  showTransfers?: boolean | undefined;
  /** Itens em cada lista (clubes, temporadas, títulos, transferências). Padrão 5; 0 = todos. */
  limit?: number | undefined;
}

const PROFILE_REFRESH_MS = 30 * 60_000;

/** Posições do fornecedor que têm tradução (as mesmas do elenco); as outras aparecem como vêm. */
type Position = (typeof SQUAD_POSITIONS)[number];
const isPosition = (v: string | null): v is Position =>
  (SQUAD_POSITIONS as readonly (string | null)[]).includes(v);

/**
 * Ficha do jogador (futebol): foto, clube atual, posição e nacionalidade; os números da temporada (jogos,
 * gols, assistências, cartões, nota) e, em blocos que se ligam e desligam, os clubes, as temporadas, os
 * títulos e as transferências. Dados de `/v1/people/{id}/overview`.
 */
export function PlayerProfile({
  personId,
  season,
  showStats = true,
  showClubs = true,
  showSeasons = true,
  showTrophies = true,
  showTransfers = true,
  limit = 5,
}: PlayerProfileProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.player;
  const overview = useGalaxieQuery<GsPersonOverview>(
    personId ? `/v1/people/${encodeURIComponent(personId)}/overview` : null,
    { season },
    () => PROFILE_REFRESH_MS,
  );
  const o = overview.data;
  if (!o) {
    return (
      <WidgetFrame kind="player_profile" busy={overview.loading}>
        {overview.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={overview.error} onRetry={overview.retry} />
        )}
      </WidgetFrame>
    );
  }
  const cut = <T,>(list: T[]) => (limit > 0 ? list.slice(0, limit) : list);
  const more = (total: number) =>
    limit > 0 && total > limit ? (
      <div className="gs-muted gs-small">{fillText(t.more, { count: total - limit })}</div>
    ) : null;
  const coach = o.role === 'coach';
  const role = coach ? t.coach : isPosition(o.position) ? t.positions[o.position] : o.position;
  const meta = [
    o.nationality_ref?.name ?? o.person.nationality,
    role,
    o.number ? `#${o.number}` : null,
    o.person.age ? fillText(t.age, { age: o.person.age }) : null,
  ].filter(Boolean);
  const s = o.totals;
  const apps = (n: number) => pluralText(t.apps, n, fmt.intl, fmt.integer);
  const appsGoals = (n: number, g: number) =>
    `${apps(n)} · ${pluralText(t.goalsCount, g, fmt.intl, fmt.integer)}`;
  const seasons = o.seasons.filter((x) => x.appearances > 0);
  const trophies = o.trophies ?? [];

  return (
    <WidgetFrame kind="player_profile">
      <header className="gs-profile">
        <Crest src={o.person.photo} name={o.person.name} size="lg" />
        <div className="gs-grow" style={{ minWidth: 0 }}>
          <h3 className="gs-title gs-truncate">{o.person.name}</h3>
          <div className="gs-line gs-meta">
            {o.nationality_ref ? <Flag iso2={o.nationality_ref.code} name={o.nationality_ref.name} /> : null}
            <span className="gs-truncate">{meta.join(' · ')}</span>
          </div>
          {o.current_team ? (
            <div className="gs-line gs-meta" data-gs-current-team={o.current_team.id}>
              <Crest src={o.current_team.logo} name={o.current_team.name} size="xs" />
              <span className="gs-truncate gs-strong">{o.current_team.name}</span>
            </div>
          ) : null}
        </div>
      </header>

      {showStats ? (
        <div className="gs-group" data-gs-block="stats">
          {o.season ? <div className="gs-group-title">{fillText(t.season, { year: o.season })}</div> : null}
          {s ? (
            <StatGrid
              items={
                coach
                  ? [[t.appearances, s.appearances]]
                  : [
                      [t.appearances, s.appearances],
                      [t.goals, s.goals],
                      [t.assists, s.assists],
                      [t.minutes, fmt.integer(s.minutes)],
                      [t.yellow, s.yellow_cards],
                      [t.red, s.red_cards],
                      [t.rating, s.rating !== null ? fmt.decimal(s.rating) : null],
                    ]
              }
            />
          ) : (
            <EmptyState>{t.empty}</EmptyState>
          )}
        </div>
      ) : null}

      {showClubs && o.career.length ? (
        <div className="gs-group" data-gs-block="clubs">
          <div className="gs-group-title">{t.clubs}</div>
          <ul className="gs-list">
            {cut(o.career).map((c) => (
              <li key={c.team.id} className="gs-fixture">
                <Crest src={c.team.logo} name={c.team.name} size="sm" />
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-truncate gs-strong">{c.team.name}</span>
                  <span className="gs-line gs-meta gs-small">
                    <span className="gs-truncate">
                      {[
                        c.from === c.to ? String(c.from) : `${c.from}–${c.to}`,
                        c.appearances
                          ? coach
                            ? apps(c.appearances)
                            : appsGoals(c.appearances, c.goals)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </span>
                {c.current ? <span className="gs-tag">{t.current}</span> : null}
              </li>
            ))}
          </ul>
          {more(o.career.length)}
        </div>
      ) : null}

      {showSeasons && seasons.length ? (
        <div className="gs-group" data-gs-block="seasons">
          <div className="gs-group-title">{t.seasons}</div>
          <ul className="gs-list">
            {cut(seasons).map((x) => (
              <li key={x.year} className="gs-fixture" aria-current={x.year === o.season || undefined}>
                <span className={x.year === o.season ? 'gs-grow gs-strong' : 'gs-grow'}>{x.year}</span>
                <span className="gs-muted gs-small">
                  {coach ? apps(x.appearances) : appsGoals(x.appearances, x.goals)}
                </span>
              </li>
            ))}
          </ul>
          {more(seasons.length)}
        </div>
      ) : null}

      {showTrophies && trophies.length ? (
        <div className="gs-group" data-gs-block="trophies">
          <div className="gs-group-title">{t.trophies}</div>
          <ul className="gs-list">
            {cut(trophies).map((x) => (
              <li key={`${x.league}-${x.country}-${x.season}-${x.place}`} className="gs-fixture">
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-truncate gs-strong">{x.league}</span>
                  <span className="gs-line gs-meta gs-small">
                    <span className="gs-truncate">{[x.season, x.country].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                {x.place ? <span className="gs-tag">{t.places[x.place] ?? x.place}</span> : null}
              </li>
            ))}
          </ul>
          {more(trophies.length)}
        </div>
      ) : null}

      {showTransfers && o.transfers.length ? (
        <div className="gs-group" data-gs-block="transfers">
          <div className="gs-group-title">{t.transfers}</div>
          <ul className="gs-list">
            {cut(o.transfers).map((x, i) => (
              <li key={`${x.date}-${x.type}-${x.from.name}-${x.to.name}-${i}`} className="gs-fixture">
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-line">
                    <Crest src={x.from.logo} name={x.from.name} size="xs" />
                    <span className="gs-truncate">{x.from.name}</span>
                    <span className="gs-muted" aria-hidden>
                      →
                    </span>
                    <Crest src={x.to.logo} name={x.to.name} size="xs" />
                    <span className="gs-truncate gs-strong">{x.to.name}</span>
                  </span>
                  <span className="gs-line gs-meta gs-small">
                    <span className="gs-truncate">
                      {[
                        x.date ? fmt.date(`${x.date}T12:00:00Z`) : null,
                        x.type ? (t.transferTypes[x.type] ?? x.type) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {more(o.transfers.length)}
        </div>
      ) : null}
    </WidgetFrame>
  );
}
