'use client';

import {
  LIVE_STATUSES,
  eventRefreshMs,
  fillText,
  sidesOf,
  type GsEvent,
  type GsTimeline,
  type GsTimelineIncident,
  type GsTimelineMarker,
  type GsTimelinePerson,
  type WidgetTexts,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface MatchTimelineProps {
  /** Id do jogo na API Galaxie. */
  eventId: string;
  /** `newest`: o lance mais recente no topo (padrão); `oldest`: na ordem do jogo. */
  order?: 'newest' | 'oldest' | undefined;
  /**
   * Grupos de lance mostrados, separados por vírgula (`goals,cards,substitutions,var,missed,shootout,other`).
   * Vazio = todos.
   */
  types?: string | undefined;
  /** Quantos lances mostrar (0 = todos). */
  limit?: number | undefined;
  /** Início, intervalo, prorrogação e fim de jogo entre os lances (padrão: sim). */
  showMarkers?: boolean | undefined;
  /** Assistência do gol (padrão: sim). */
  showAssists?: boolean | undefined;
  /** Os times e o placar no topo (padrão: sim; busca o jogo). */
  showMatch?: boolean | undefined;
}

type IncidentKind = keyof WidgetTexts['timeline']['kinds'];

/** Grupo de cada tipo de lance da API (o filtro `types` do Builder). */
const GROUP_OF: Record<IncidentKind, string> = {
  goal: 'goals',
  own_goal: 'goals',
  penalty_goal: 'goals',
  penalty_missed: 'missed',
  yellow_card: 'cards',
  second_yellow: 'cards',
  red_card: 'cards',
  substitution: 'substitutions',
  var: 'var',
  shootout_scored: 'shootout',
  shootout_missed: 'shootout',
  other: 'other',
};

const PERIOD_RANK: Record<string, number> = {
  first_half: 1,
  second_half: 2,
  extra_time_first: 3,
  extra_time_second: 4,
  penalty_shootout: 5,
};
/** Onde cada marco cai entre os períodos (o fim de jogo vem depois da disputa de pênaltis). */
const MARKER_RANK: Record<GsTimelineMarker['kind'], number> = {
  kickoff: 0.5,
  halftime: 1.5,
  second_half: 1.6,
  end_of_regulation: 2.5,
  extra_time: 2.6,
  penalty_shootout: 4.5,
  full_time: 99,
};
const LIVE_REFRESH_MS = 20_000;
const WAITING_REFRESH_MS = 60_000;
const DONE_STATUSES = new Set(['finished', 'cancelled', 'abandoned', 'postponed']);

type Item =
  | { type: 'incident'; key: string; sort: number[]; incident: GsTimelineIncident }
  | { type: 'marker'; key: string; sort: number[]; marker: GsTimelineMarker };

const kindOf = (kind: string): IncidentKind => (kind in GROUP_OF ? (kind as IncidentKind) : 'other');

/** Lances e marcos numa linha só, na ordem do jogo (período, minuto, acréscimo; o marco de início antes). */
function timelineItems(
  data: GsTimeline,
  { types, showMarkers }: { types: ReadonlySet<string> | null; showMarkers: boolean },
): Item[] {
  const items: Item[] = [];
  for (const i of data.incidents) {
    if (types && !types.has(GROUP_OF[kindOf(i.kind)])) continue;
    const period = i.clock?.period ?? null;
    items.push({
      type: 'incident',
      key: `i${i.sequence}`,
      // sem período (outros esportes): a ordem do fornecedor manda
      sort: [period ? (PERIOD_RANK[period] ?? 0) : 0, i.minute ?? 0, i.extra ?? 0, i.sequence],
      incident: i,
    });
  }
  if (showMarkers) {
    for (const m of data.markers ?? []) {
      items.push({
        type: 'marker',
        key: `m${m.kind}`,
        sort: [MARKER_RANK[m.kind] ?? 99, 0, 0, 0],
        marker: m,
      });
    }
  }
  return items.sort((a, b) => {
    for (let k = 0; k < a.sort.length; k++) {
      const d = (a.sort[k] ?? 0) - (b.sort[k] ?? 0);
      if (d) return d;
    }
    return 0;
  });
}

/**
 * Lance a lance de um jogo: gols, cartões, substituições, VAR e pênaltis, minuto a minuto, com os marcos do
 * jogo (intervalo, fim). Vale para qualquer esporte com timeline na API; atualiza sozinho durante a partida.
 */
export function MatchTimeline({
  eventId,
  order = 'newest',
  types,
  limit = 0,
  showMarkers = true,
  showAssists = true,
  showMatch = true,
}: MatchTimelineProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.timeline;
  const enc = encodeURIComponent;
  const query = useGalaxieQuery<GsTimeline>(
    eventId ? `/v1/events/${enc(eventId)}/timeline` : null,
    {},
    (d) => (d.live ? LIVE_REFRESH_MS : d.status && DONE_STATUSES.has(d.status) ? null : WAITING_REFRESH_MS),
  );
  const match = useGalaxieQuery<GsEvent>(
    eventId && showMatch ? `/v1/events/${enc(eventId)}` : null,
    {},
    (event) => eventRefreshMs(event),
  );
  const data = query.data;
  if (!data) {
    return (
      <WidgetFrame kind="match_timeline" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const picked = types
    ? new Set(
        types
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;
  const all = timelineItems(data, { types: picked?.size ? picked : null, showMarkers });
  const ordered = order === 'oldest' ? all : [...all].reverse();
  // o limite conta lances; os marcos entre eles vêm junto
  let left = limit > 0 ? limit : Infinity;
  const shown = ordered.filter((item) => {
    if (item.type === 'marker') return left > 0;
    if (left <= 0) return false;
    left--;
    return true;
  });
  // marco sem lance depois dele (no fim do recorte) não diz nada
  while (shown.length && shown[shown.length - 1]!.type === 'marker' && limit > 0) shown.pop();
  const hasIncident = shown.some((i) => i.type === 'incident');
  const event = match.data;
  const started = data.status ? data.status !== 'scheduled' && data.status !== 'starting' : true;
  return (
    <WidgetFrame kind="match_timeline">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
        <span className="gs-spacer" />
        {event ? (
          <StatusBadge event={event} />
        ) : data.live ? (
          <span className="gs-badge" data-tone="live">
            <span className="gs-dot" aria-hidden="true" />
            {data.clock?.display ?? texts.status.live}
          </span>
        ) : null}
      </header>
      {event ? <MatchLine event={event} score={data.score} /> : null}
      {!hasIncident ? (
        <EmptyState>{started ? t.empty : t.notStarted}</EmptyState>
      ) : (
        <ol className="gs-tl" data-order={order}>
          {shown.map((item) =>
            item.type === 'marker' ? (
              <li key={item.key} className="gs-tl-marker" data-marker={item.marker.kind}>
                {t.markers[item.marker.kind] ?? item.marker.kind}
              </li>
            ) : (
              <Incident
                key={item.key}
                incident={item.incident}
                teams={event ? sidesOf(event) : null}
                showAssists={showAssists}
              />
            ),
          )}
        </ol>
      )}
    </WidgetFrame>
  );
}

/** Os dois times com o placar do minuto a minuto (o mais novo que chegou). */
function MatchLine({ event, score }: { event: GsEvent; score: GsTimeline['score'] }) {
  const { home, away } = sidesOf(event);
  const h = score?.home ?? event.score.home;
  const a = score?.away ?? event.score.away;
  return (
    <div className="gs-tl-match" data-live={LIVE_STATUSES.has(event.status) || undefined}>
      <Crest src={home?.logo} name={home?.name ?? '?'} size="sm" />
      <span className="gs-truncate">{home?.name ?? '?'}</span>
      <span className="gs-tl-score">{h === null || a === null ? '–' : `${h} – ${a}`}</span>
      <span className="gs-truncate">{away?.name ?? '?'}</span>
      <Crest src={away?.logo} name={away?.name ?? '?'} size="sm" />
    </div>
  );
}

function iconOf(kind: IncidentKind): string {
  switch (kind) {
    case 'goal':
    case 'penalty_goal':
    case 'shootout_scored':
      return 'goal';
    case 'own_goal':
      return 'own_goal';
    case 'penalty_missed':
    case 'shootout_missed':
      return 'miss';
    case 'yellow_card':
      return 'yellow';
    case 'second_yellow':
      return 'second_yellow';
    case 'red_card':
      return 'red';
    case 'substitution':
      return 'sub';
    case 'var':
      return 'var';
    case 'other':
      return 'other';
  }
}

const ICON_TEXT: Record<string, string> = { miss: '✕', sub: '⇄', var: 'VAR', other: '•' };

const personName = (p: GsTimelinePerson | null | undefined) => p?.name ?? null;

function Incident({
  incident: i,
  teams,
  showAssists,
}: {
  incident: GsTimelineIncident;
  teams: ReturnType<typeof sidesOf> | null;
  showAssists: boolean;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.timeline;
  const kind = kindOf(i.kind);
  const icon = iconOf(kind);
  const minute = i.clock?.display ?? (i.minute === null ? '' : `${i.minute}${i.extra ? `+${i.extra}` : ''}'`);
  const goal = GROUP_OF[kind] === 'goals' || kind === 'shootout_scored';
  // no gol, o time que somou (gol contra conta para o adversário)
  const team = (goal ? i.scoring_team : null) ?? i.team;
  const side =
    team?.side === 'home' || team?.side === 'away'
      ? team.side
      : team?.id && teams?.home?.id === team.id
        ? 'home'
        : team?.id && teams?.away?.id === team.id
          ? 'away'
          : undefined;
  const teamRef = side && teams ? teams[side] : undefined;
  const teamName = team?.name ?? teamRef?.name ?? null;
  const teamLogo = team?.logo ?? teamRef?.logo ?? null;
  const subIn = kind === 'substitution' ? (i.player_in ?? i.assist) : null;
  const subOut = kind === 'substitution' ? (i.player_out ?? i.player) : null;
  const who = kind === 'substitution' ? null : personName(i.player);
  const assist =
    showAssists && GROUP_OF[kind] === 'goals' && kind !== 'own_goal' ? personName(i.assist) : null;
  // VAR: o texto do fornecedor diz o que houve ("Goal cancelled" → "Gol anulado")
  const label =
    kind === 'var'
      ? `${t.kinds.var} · ${t.var[(i.detail ?? '').toLowerCase()] ?? i.detail ?? t.varReview}`
      : i.disallowed
        ? `${t.kinds[kind]} · ${t.disallowed}`
        : t.kinds[kind];
  return (
    <li
      className="gs-tl-item"
      data-kind={i.kind}
      data-side={side}
      data-key={i.key_moment || undefined}
      data-disallowed={i.disallowed || undefined}
      data-gs-incident={i.sequence}
    >
      <span className="gs-tl-min">{minute}</span>
      <span className="gs-tl-icon" data-icon={icon} aria-hidden="true">
        {ICON_TEXT[icon] ?? ''}
      </span>
      <div className="gs-tl-body">
        <span className="gs-tl-head">
          {teamName ? <Crest src={teamLogo} name={teamName} size="xs" /> : null}
          <span className="gs-truncate">{label}</span>
        </span>
        {who ? <span className="gs-tl-who">{who}</span> : null}
        {subIn ? <span className="gs-tl-who">{`${t.playerIn}: ${personName(subIn)}`}</span> : null}
        {subOut ? <span className="gs-meta">{`${t.playerOut}: ${personName(subOut)}`}</span> : null}
        {assist ? <span className="gs-meta">{fillText(t.assist, { name: assist })}</span> : null}
      </div>
      <span className="gs-tl-score">
        {goal && i.score_after ? `${i.score_after.home}-${i.score_after.away}` : ''}
      </span>
    </li>
  );
}
