'use client';

import { useState } from 'react';
import { fillText, sidesOf, type GsEvent, type WidgetLocale } from '../core/model.js';
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

export interface LineupsProps {
  /** Id do jogo de futebol na API Galaxie. */
  eventId: string;
  /** `pitch` = titulares no desenho do campo; `list` = lista por time (padrão: campo). */
  view?: 'pitch' | 'list' | undefined;
  /** Reservas de cada time (padrão: sim). */
  showSubstitutes?: boolean | undefined;
  /** Técnico de cada time (padrão: sim). */
  showCoach?: boolean | undefined;
  /** Os dois times ou só o mandante/visitante (padrão: os dois). */
  team?: 'both' | 'home' | 'away' | undefined;
}

/** Pessoa na escalação (`PersonRef` da API): id null quando ainda não está no core. */
export interface GsLineupPerson {
  id: string | null;
  name: string;
  photo?: string | null | undefined;
}

export interface GsLineupPlayer {
  person: GsLineupPerson;
  number: number | null;
  /** `G`, `D`, `M`, `F` (goleiro, defensor, meio-campista, atacante). */
  position: string | null;
  /** "linha:coluna" no campo (goleiro `1:1`); null sem posição no desenho. */
  grid: string | null;
}

export interface GsTeamLineup {
  team: { id: string | null; name: string | null; side: string | null; logo: string | null };
  formation: string | null;
  coach: GsLineupPerson | null;
  start_xi: GsLineupPlayer[];
  substitutes: GsLineupPlayer[];
}

/** Escalações completas (`/v1/events/{id}/lineups`). `available: false` = ainda não divulgadas. */
export interface GsEventLineups {
  event_id: string;
  available: boolean;
  lineups: GsTeamLineup[];
}

interface LineupTexts {
  title: string;
  starters: string;
  substitutes: string;
  coach: string;
  notAnnounced: string;
  notAnnouncedHint: string;
  pitchLabel: string;
  positions: Record<string, string>;
}

const LINEUP_TEXTS: Record<WidgetLocale, LineupTexts> = {
  'pt-BR': {
    title: 'Escalações',
    starters: 'Titulares',
    substitutes: 'Reservas',
    coach: 'Técnico',
    notAnnounced: 'Escalação ainda não divulgada.',
    notAnnouncedHint: 'Os times costumam divulgar cerca de uma hora antes do jogo.',
    pitchLabel: 'Escalação no campo: {teams}',
    positions: { G: 'GOL', D: 'DEF', M: 'MEI', F: 'ATA' },
  },
  es: {
    title: 'Alineaciones',
    starters: 'Titulares',
    substitutes: 'Suplentes',
    coach: 'Entrenador',
    notAnnounced: 'Alineación aún no confirmada.',
    notAnnouncedHint: 'Los equipos suelen confirmarla una hora antes del partido.',
    pitchLabel: 'Alineación en la cancha: {teams}',
    positions: { G: 'POR', D: 'DEF', M: 'MED', F: 'DEL' },
  },
  en: {
    title: 'Lineups',
    starters: 'Starting XI',
    substitutes: 'Substitutes',
    coach: 'Head coach',
    notAnnounced: 'Lineups not announced yet.',
    notAnnouncedHint: 'Teams usually announce them about an hour before kick-off.',
    pitchLabel: 'Lineup on the pitch: {teams}',
    positions: { G: 'GK', D: 'DF', M: 'MF', F: 'FW' },
  },
};

/** Escalação divulgada: a API ainda pode trazer um time sem titulares, que conta como não divulgado. */
const PENDING_REFRESH_MS = 5 * 60_000;

/** Estilo só deste widget (o núcleo `WIDGET_CSS` fica igual): campo, fileiras e listas por time. */
const LINEUPS_CSS = `
.gs-lu-teams{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--gs-gap)}
.gs-lu-team{display:flex;flex-direction:column;gap:6px;min-width:0}
.gs-lu-team-head{display:flex;align-items:center;gap:8px;min-width:0;font-weight:700}
.gs-lu-formation{margin-left:auto;padding:1px 7px;border:1px solid var(--gs-border);border-radius:999px;font-size:.75em;font-variant-numeric:tabular-nums;color:var(--gs-muted-foreground)}
.gs-lu-player{display:flex;align-items:center;gap:8px;min-width:0;padding:3px 0;border-top:1px solid var(--gs-border)}
.gs-lu-player:first-child{border-top:0}
.gs-lu-num{flex:none;width:22px;text-align:right;font-variant-numeric:tabular-nums;color:var(--gs-muted-foreground)}
.gs-lu-pos{flex:none;margin-left:auto;font-size:.75em;color:var(--gs-muted-foreground)}
.gs-lu-coach{display:flex;align-items:center;gap:8px;min-width:0;padding-top:6px;border-top:1px solid var(--gs-border)}
.gs-lu-pitch{position:relative;width:100%;max-width:420px;margin:0 auto;aspect-ratio:68/100;overflow:hidden;border-radius:calc(var(--gs-radius)/1.5);background:#14532d repeating-linear-gradient(to bottom,rgb(255 255 255/.04) 0 6.25%,transparent 6.25% 12.5%);color:#fff}
.gs-lu-pitch[data-half]{aspect-ratio:68/56}
.gs-lu-lines{position:absolute;inset:0;width:100%;height:100%;color:rgb(255 255 255/.25)}
.gs-lu-spot{position:absolute;display:flex;flex-direction:column;align-items:center;gap:2px;width:24%;transform:translate(-50%,-50%)}
.gs-lu-shirt{display:grid;place-items:center;width:28px;height:28px;border:2px solid var(--gs-lu-color,#fff);border-radius:50%;overflow:hidden;background:rgb(0 0 0/.35);font-size:.78em;font-weight:700;font-variant-numeric:tabular-nums;color:#fff}
.gs-lu-shirt img{width:100%;height:100%;object-fit:cover}
.gs-lu-name{max-width:100%;padding:0 4px;border-radius:4px;background:rgb(0 0 0/.45);font-size:.7em;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-lu-bar{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 10px;background:rgb(0 0 0/.25);font-size:.85em;font-weight:600}
.gs-lu-bar .gs-lu-formation{color:#fff;border-color:rgb(255 255 255/.3)}
.gs-lu-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--gs-lu-color,#fff)}
.gs-lu-board{display:flex;flex-direction:column;max-width:420px;width:100%;margin:0 auto;overflow:hidden;border-radius:calc(var(--gs-radius)/1.5);background:#14532d;color:#fff}
.gs-lu-board .gs-lu-pitch{border-radius:0;max-width:none}
`;

/** Cor do anel de cada time no campo: o mandante na cor do tema, o visitante em branco. */
const SIDE_COLORS = ['var(--gs-primary)', '#ffffff'] as const;

/**
 * Escalações de um jogo de futebol: os titulares no desenho do campo (ou em lista), os reservas e o técnico
 * de cada time. Antes da divulgação mostra "escalação ainda não divulgada" e confere de novo a cada 5 minutos.
 */
export function Lineups({
  eventId,
  view = 'pitch',
  showSubstitutes = true,
  showCoach = true,
  team = 'both',
}: LineupsProps) {
  const { locale } = useGalaxieWidget();
  const t = LINEUP_TEXTS[locale] ?? LINEUP_TEXTS['pt-BR'];
  const enc = encodeURIComponent;
  const query = useGalaxieQuery<GsEventLineups>(
    eventId ? `/v1/events/${enc(eventId)}/lineups` : null,
    {},
    (data) => (isAnnounced(data) ? null : PENDING_REFRESH_MS),
  );
  const data = query.data;
  const announced = data ? isAnnounced(data) : false;
  // antes da divulgação a resposta não traz os times: o jogo dá os nomes e o horário
  const event = useGalaxieQuery<GsEvent>(data && !announced ? `/v1/events/${enc(eventId)}` : null);

  if (!data) {
    return (
      <WidgetFrame kind="lineups" busy={query.loading}>
        <style>{LINEUPS_CSS}</style>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  if (!announced) {
    return (
      <WidgetFrame kind="lineups">
        <style>{LINEUPS_CSS}</style>
        <PendingHeader title={t.title} event={event.data} />
        <EmptyState>
          <span>
            {t.notAnnounced}
            <br />
            <span className="gs-muted gs-small">{t.notAnnouncedHint}</span>
          </span>
        </EmptyState>
      </WidgetFrame>
    );
  }

  const shown = pickTeams(data.lineups, team);
  const pitch = view === 'pitch' && shown.every(hasGrid);
  return (
    <WidgetFrame kind="lineups">
      <style>{LINEUPS_CSS}</style>
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
      </header>
      {pitch ? <Pitch lineups={shown} texts={t} /> : null}
      <div className="gs-lu-teams">
        {shown.map((l) => {
          const subs = showSubstitutes && l.substitutes.length > 0;
          const coach = showCoach && l.coach ? l.coach : null;
          // no campo os titulares já estão desenhados: embaixo ficam só reservas e técnico
          if (pitch && !subs && !coach) return null;
          return (
            <div key={l.team.id ?? l.team.side ?? l.team.name} className="gs-lu-team">
              <TeamHeading lineup={l} formation={!pitch} />
              {pitch ? null : <PlayerList title={t.starters} players={l.start_xi} texts={t} />}
              {subs ? <PlayerList title={t.substitutes} players={l.substitutes} texts={t} /> : null}
              {coach ? (
                <div className="gs-lu-coach">
                  <Crest src={coach.photo} name={coach.name} size="sm" />
                  <span className="gs-truncate">{coach.name}</span>
                  <span className="gs-lu-pos">{t.coach}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </WidgetFrame>
  );
}

/** Divulgada = pelo menos um time com titulares. */
function isAnnounced(data: GsEventLineups): boolean {
  return data.available && data.lineups.some((l) => l.start_xi.length > 0);
}

/** Os dois times (mandante primeiro) ou só um lado; sem lado conhecido, a ordem da API. */
function pickTeams(lineups: GsTeamLineup[], team: 'both' | 'home' | 'away'): GsTeamLineup[] {
  const withXi = lineups.filter((l) => l.start_xi.length > 0);
  if (team === 'both') return withXi;
  const index = team === 'home' ? 0 : 1;
  const bySide = withXi.find((l) => l.team.side === team) ?? lineups[index];
  return bySide && bySide.start_xi.length ? [bySide] : withXi.slice(0, 1);
}

const GRID_RE = /^(\d+):(\d+)$/;

/** Dá para desenhar o campo: quase todos os titulares com `grid`. */
function hasGrid(lineup: GsTeamLineup): boolean {
  return lineup.start_xi.filter((p) => GRID_RE.test(p.grid ?? '')).length >= 10;
}

/** Fileiras do campo a partir do `grid` "linha:coluna" (goleiro na linha 1). */
export function pitchRows(players: readonly GsLineupPlayer[]): GsLineupPlayer[][] {
  const rows = new Map<number, { col: number; p: GsLineupPlayer }[]>();
  for (const p of players) {
    const m = GRID_RE.exec(p.grid ?? '');
    if (!m) continue;
    const row = Number(m[1]);
    rows.set(row, [...(rows.get(row) ?? []), { col: Number(m[2]), p }]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, list]) => list.sort((a, b) => a.col - b.col).map((x) => x.p));
}

/** Nome curto no campo: até dois nomes inteiros, senão o primeiro ("Vinícius Júnior", "Raphinha"). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length <= 2 ? parts.join(' ') : parts[0]!;
}

/**
 * Posição de cada titular em % do gramado. Com os dois times, o mandante ataca para baixo (goleiro em cima)
 * e o visitante para cima; com um time só, ele ocupa o meio-campo inteiro, goleiro embaixo. A coluna 1 do
 * grid é o lado esquerdo do time: quem está de frente para quem olha (o mandante) fica espelhado.
 */
function placed(lineup: GsTeamLineup, half: 'top' | 'bottom' | 'single') {
  const rows = pitchRows(lineup.start_xi);
  const [first, last] = half === 'single' ? [8, 92] : [6, 44];
  const step = rows.length > 1 ? (last - first) / (rows.length - 1) : 0;
  return rows.flatMap((row, r) => {
    const depth = first + r * step;
    const ordered = half === 'top' ? [...row].reverse() : row;
    return ordered.map((player, c) => ({
      player,
      x: ((c + 0.5) / ordered.length) * 100,
      y: half === 'top' ? depth : 100 - depth,
    }));
  });
}

function Pitch({ lineups, texts }: { lineups: GsTeamLineup[]; texts: LineupTexts }) {
  const [home, away] = lineups;
  if (!home) return null;
  const single = !away;
  const spots = single
    ? placed(home, 'single').map((s) => ({ ...s, color: SIDE_COLORS[0] }))
    : [
        ...placed(home, 'top').map((s) => ({ ...s, color: SIDE_COLORS[0] })),
        ...placed(away, 'bottom').map((s) => ({ ...s, color: SIDE_COLORS[1] })),
      ];
  const label = fillText(texts.pitchLabel, {
    teams: lineups.map((l) => l.team.name ?? '').join(' x '),
  });
  return (
    <div className="gs-lu-board" role="group" aria-label={label}>
      <PitchBar lineup={home} color={SIDE_COLORS[0]} />
      <div className="gs-lu-pitch" data-half={single || undefined}>
        <PitchLines half={single} />
        {spots.map(({ player, x, y, color }) => (
          <div
            key={`${player.person.id ?? player.person.name}-${player.number}`}
            className="gs-lu-spot"
            style={{ left: `${x}%`, top: `${y}%`, ['--gs-lu-color' as string]: color }}
            title={player.person.name}
          >
            <Shirt player={player} />
            <span className="gs-lu-name">{shortName(player.person.name)}</span>
          </div>
        ))}
      </div>
      {away ? <PitchBar lineup={away} color={SIDE_COLORS[1]} /> : null}
    </div>
  );
}

/** Foto do jogador no anel da cor do time; sem foto (ou foto quebrada), o número da camisa. */
function Shirt({ player }: { player: GsLineupPlayer }) {
  const [broken, setBroken] = useState(false);
  const photo = player.person.photo;
  return (
    <span className="gs-lu-shirt" aria-hidden="true">
      {photo && !broken ? (
        <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        (player.number ?? '')
      )}
    </span>
  );
}

function PitchBar({ lineup, color }: { lineup: GsTeamLineup; color: string }) {
  return (
    <div className="gs-lu-bar" style={{ ['--gs-lu-color' as string]: color }}>
      <span className="gs-lu-dot" aria-hidden="true" />
      <Crest src={lineup.team.logo} name={lineup.team.name ?? ''} size="xs" />
      <span className="gs-truncate">{lineup.team.name}</span>
      {lineup.formation ? <span className="gs-lu-formation">{lineup.formation}</span> : null}
    </div>
  );
}

/** Linhas do gramado (SVG esticado). `half` = só um meio-campo, com o gol embaixo. */
function PitchLines({ half }: { half: boolean }) {
  const W = 68;
  const H = half ? 56 : 100;
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.35 };
  const mid = W / 2;
  const goals = half ? [H - 1.5] : [1.5, H - 1.5];
  return (
    <svg className="gs-lu-lines" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <rect x={1.5} y={half ? -1 : 1.5} width={W - 3} height={half ? H - 0.5 : H - 3} {...line} />
      {half ? null : <line x1={1.5} y1={H / 2} x2={W - 1.5} y2={H / 2} {...line} />}
      {half ? null : <circle cx={mid} cy={H / 2} r={9} {...line} />}
      {goals.map((y) => {
        const dir = y < H / 2 ? 1 : -1;
        return (
          <g key={y}>
            <rect x={mid - 20} y={dir > 0 ? y : y - 15} width={40} height={15} {...line} />
            <rect x={mid - 9} y={dir > 0 ? y : y - 5} width={18} height={5} {...line} />
            <circle cx={mid} cy={y + dir * 10.5} r={0.5} fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
}

function TeamHeading({ lineup, formation = true }: { lineup: GsTeamLineup; formation?: boolean }) {
  return (
    <div className="gs-lu-team-head">
      <Crest src={lineup.team.logo} name={lineup.team.name ?? ''} size="sm" />
      <span className="gs-truncate">{lineup.team.name}</span>
      {formation && lineup.formation ? <span className="gs-lu-formation">{lineup.formation}</span> : null}
    </div>
  );
}

function PlayerList({
  title,
  players,
  texts,
}: {
  title: string;
  players: GsLineupPlayer[];
  texts: LineupTexts;
}) {
  return (
    <div className="gs-group">
      <div className="gs-group-title">{title}</div>
      <ul className="gs-list">
        {players.map((p) => (
          <li key={`${p.person.id ?? p.person.name}-${p.number}`} className="gs-lu-player">
            <span className="gs-lu-num">{p.number ?? ''}</span>
            <span className="gs-truncate">{p.person.name}</span>
            {p.position ? (
              <span className="gs-lu-pos">{texts.positions[p.position] ?? p.position}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Antes da divulgação: os dois times e a hora do jogo (do `/v1/events/{id}`), quando já chegaram. */
function PendingHeader({ title, event }: { title: string; event: GsEvent | null }) {
  const fmt = useFormatters();
  const { home, away } = event ? sidesOf(event) : { home: undefined, away: undefined };
  return (
    <header className="gs-header">
      <h3 className="gs-title">{title}</h3>
      <span className="gs-spacer" />
      {home && away ? <span className="gs-truncate">{`${home.name} x ${away.name}`}</span> : null}
      {event?.starts_at ? <time dateTime={event.starts_at}>{fmt.dateTime(event.starts_at)}</time> : null}
    </header>
  );
}
