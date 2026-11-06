'use client';

import { SQUAD_POSITIONS, fillText, type GsSquad, type GsSquadMember, type GsTeam } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface TeamSquadProps {
  /** Id do time na API Galaxie. */
  teamId: string;
  /** Ano da temporada (inscritos do ano + quem entrou em campo). Sem ele, o elenco atual. */
  season?: number | undefined;
  /** Foto de cada jogador (padrão: sim). */
  showPhotos?: boolean | undefined;
  /** Agrupar por posição: goleiros, defensores, meio-campistas, atacantes (padrão: sim). */
  groupByPosition?: boolean | undefined;
  /** Número da camisa (padrão: sim). */
  showNumber?: boolean | undefined;
  /** Idade (padrão: sim). */
  showAge?: boolean | undefined;
  /** Bandeira e nacionalidade (padrão: sim). */
  showNationality?: boolean | undefined;
  /** Técnicos no fim da lista (padrão: sim). */
  showCoaches?: boolean | undefined;
}

const REFRESH_MS = 6 * 60 * 60_000;

/** Ordem na lista: posição (goleiro primeiro), número da camisa (sem número no fim) e nome. */
function byShirt(a: GsSquadMember, b: GsSquadMember): number {
  return (
    (a.number ?? Infinity) - (b.number ?? Infinity) || a.person.name.localeCompare(b.person.name, 'pt-BR')
  );
}

const positionRank = (p: string | null) => {
  const i = p ? SQUAD_POSITIONS.indexOf(p as (typeof SQUAD_POSITIONS)[number]) : -1;
  return i === -1 ? SQUAD_POSITIONS.length : i;
};

interface Meta {
  photos: boolean;
  number: boolean;
  age: boolean;
  nationality: boolean;
}

/** Elenco do time: jogadores por posição, com foto, número, idade e nacionalidade, e os técnicos. */
export function TeamSquad({
  teamId,
  season,
  showPhotos = true,
  groupByPosition = true,
  showNumber = true,
  showAge = true,
  showNationality = true,
  showCoaches = true,
}: TeamSquadProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.squad;
  const id = teamId ? encodeURIComponent(teamId) : null;
  const query = useGalaxieQuery<GsSquad>(id ? `/v1/teams/${id}/squad` : null, { season }, () => REFRESH_MS);
  const team = useGalaxieQuery<GsTeam>(id ? `/v1/teams/${id}` : null, {}, () => REFRESH_MS);
  const meta: Meta = { photos: showPhotos, number: showNumber, age: showAge, nationality: showNationality };

  const header = (
    <header className="gs-header">
      {team.data ? <Crest src={team.data.logo} name={team.data.name} size="sm" /> : null}
      <span className="gs-grow">
        <h3 className="gs-title gs-truncate">{team.data ? team.data.name : t.title}</h3>
        {query.data ? (
          <span className="gs-meta">
            {[
              team.data ? t.title : null,
              query.data.players.length ? fillText(t.players, { n: query.data.players.length }) : null,
              query.data.season ? fillText(t.season, { year: query.data.season }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </span>
    </header>
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="team_squad" busy={query.loading}>
        {header}
        {query.loading ? (
          <LoadingState lines={8} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const players = [...query.data.players].sort(
    (a, b) => positionRank(a.position) - positionRank(b.position) || byShirt(a, b),
  );
  const groups: { key: string; label: string | null; members: GsSquadMember[] }[] = [];
  if (groupByPosition) {
    for (const p of players) {
      const known = p.position && positionRank(p.position) < SQUAD_POSITIONS.length;
      const key = known ? p.position! : 'others';
      const group = groups.find((g) => g.key === key);
      if (group) group.members.push(p);
      else groups.push({ key, label: known ? (t.positions[key] ?? key) : t.others, members: [p] });
    }
  } else if (players.length) {
    groups.push({ key: 'players', label: null, members: players });
  }
  if (showCoaches && query.data.coaches.length)
    groups.push({ key: 'coaches', label: t.coaches, members: [...query.data.coaches] });

  return (
    <WidgetFrame kind="team_squad">
      {header}
      {groups.length === 0 ? <EmptyState>{t.empty}</EmptyState> : null}
      {groups.map((g) => (
        <div key={g.key} className="gs-group" data-gs-group={g.key}>
          {g.label ? <div className="gs-group-title">{g.label}</div> : null}
          <ul className="gs-list">
            {g.members.map((m) => (
              <Member key={`${g.key}-${m.person.id}`} member={m} meta={meta} />
            ))}
          </ul>
        </div>
      ))}
    </WidgetFrame>
  );
}

function Member({ member, meta }: { member: GsSquadMember; meta: Meta }) {
  const { texts } = useGalaxieWidget();
  const t = texts.squad;
  const p = member.person;
  const country = p.nationality_ref;
  const details = [
    meta.nationality ? (country?.name ?? p.nationality) : null,
    meta.age && p.age ? fillText(t.age, { age: p.age }) : null,
  ].filter(Boolean);
  return (
    <li className="gs-fixture" data-gs-person={p.id}>
      {meta.number ? (
        <span
          className="gs-shirt"
          aria-label={member.number != null ? fillText(t.number, { number: member.number }) : undefined}
        >
          {member.number ?? ''}
        </span>
      ) : null}
      {meta.photos ? <Crest src={p.photo} name={p.name} size="sm" className="gs-crest gs-photo" /> : null}
      <span className="gs-grow" style={{ minWidth: 0 }}>
        <span className="gs-truncate gs-strong">{p.name}</span>
        {details.length ? (
          <span className="gs-line gs-meta">
            {meta.nationality && country ? <Flag iso2={country.code} name={country.name} /> : null}
            <span className="gs-truncate">{details.join(' · ')}</span>
          </span>
        ) : null}
      </span>
    </li>
  );
}
