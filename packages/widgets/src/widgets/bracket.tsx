'use client';

import { useEffect, useState } from 'react';

import type { GsBracket, GsBracketRound, GsBracketTie, WidgetTexts } from '../core/model.js';
import { BRACKET_PHASES, LIVE_STATUSES } from '../core/model.js';
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

export type BracketPhase = (typeof BRACKET_PHASES)[number];

export interface BracketProps {
  /** UUID ou slug da competição. */
  competitionId: string;
  /** Ano da temporada; padrão: a atual. */
  season?: number | 'current' | undefined;
  /** A partir de qual fase mostrar (`round_of_16`, `quarter_final`…). Padrão: todas. */
  from?: BracketPhase | 'all' | undefined;
  /** Placar agregado da ida e volta (padrão: sim). */
  showAggregate?: boolean | undefined;
  /** Placar de cada jogo da ida e volta, em miúdo (padrão: sim). */
  showLegs?: boolean | undefined;
  /** Data do próximo jogo nos confrontos em aberto (padrão: sim). */
  showDates?: boolean | undefined;
  /** Disputa do 3º lugar, quando houver (padrão: sim). */
  showThirdPlace?: boolean | undefined;
  /**
   * `bracket`: as fases lado a lado, com rolagem horizontal; `rounds`: uma fase por vez, escolhida no topo;
   * `auto` (padrão): fase por fase quando o espaço é estreito (celular), chaveamento quando cabe.
   */
  layout?: 'auto' | 'bracket' | 'rounds' | undefined;
  /** UUID de um time para destacar os confrontos dele (o clube do portal, por exemplo). */
  highlightTeamId?: string | undefined;
}

/** Abaixo desta largura (px), o `auto` mostra fase por fase. */
const NARROW_PX = 480;
const LIVE_REFRESH_MS = 60_000;
const SOON_REFRESH_MS = 5 * 60_000;
const OPEN_REFRESH_MS = 30 * 60_000;

function refreshOf(b: GsBracket): number | null {
  const legs = b.rounds.flatMap((r) => r.ties.flatMap((t) => t.legs));
  if (legs.some((l) => LIVE_STATUSES.has(l.status) || l.status === 'starting')) return LIVE_REFRESH_MS;
  const now = Date.now();
  if (legs.some((l) => l.status === 'scheduled' && Date.parse(l.starts_at) - now < 2 * 3600_000))
    return SOON_REFRESH_MS;
  return b.rounds.some((r) => r.ties.some((t) => t.status !== 'decided')) ? OPEN_REFRESH_MS : null;
}

/** Fases a partir de `from` (as de tipo desconhecido ficam); se o recorte esvaziar, todas. */
export function bracketRoundsFrom(
  rounds: GsBracketRound[],
  from: BracketPhase | 'all',
  showThirdPlace: boolean,
): GsBracketRound[] {
  const rank = (kind: string) => (BRACKET_PHASES as readonly string[]).indexOf(kind);
  const min = from === 'all' ? -1 : rank(from);
  const kept = rounds.filter((r) => rank(r.kind) < 0 || rank(r.kind) >= min);
  const out = kept.length ? kept : rounds;
  return showThirdPlace ? out : out.filter((r) => r.kind !== 'third_place');
}

/** Fase aberta no modo fase por fase: a primeira com confronto em aberto; senão a última. */
export function currentRoundIndex(rounds: GsBracketRound[]): number {
  const open = rounds.findIndex(
    (r) => r.kind !== 'third_place' && r.ties.some((t) => t.status !== 'decided'),
  );
  if (open >= 0) return open;
  for (let i = rounds.length - 1; i >= 0; i--) if (rounds[i]!.kind !== 'third_place') return i;
  return 0;
}

/** Largura do contêiner (para o `auto`), medida pelo elemento do ref; null até medir (e no servidor). */
function useWidth(): [(el: HTMLDivElement | null) => void, number | null] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width || null);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width || null));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

/** Chaveamento do mata-mata: as fases com os confrontos, ida e volta, agregado, pênaltis e quem avançou. */
export function Bracket({
  competitionId,
  season = 'current',
  from = 'all',
  showAggregate = true,
  showLegs = true,
  showDates = true,
  showThirdPlace = true,
  layout = 'auto',
  highlightTeamId,
}: BracketProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.bracket;
  const [ref, width] = useWidth();
  const [picked, setPicked] = useState<number | null>(null);
  const query = useGalaxieQuery<GsBracket>(
    competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/seasons/${encodeURIComponent(String(season))}/bracket`
      : null,
    {},
    refreshOf,
  );
  const b = query.data;
  if (!b) {
    return (
      <WidgetFrame kind="bracket" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const rounds = bracketRoundsFrom(b.rounds, from, showThirdPlace);
  const narrow = layout === 'rounds' || (layout === 'auto' && width != null && width < NARROW_PX);
  const show = { showAggregate, showLegs, showDates, highlightTeamId };
  const active = Math.min(picked ?? currentRoundIndex(rounds), Math.max(0, rounds.length - 1));
  return (
    <WidgetFrame kind="bracket">
      <div ref={ref} className="gs-group" data-gs-layout={narrow ? 'rounds' : 'bracket'}>
        <h3 className="gs-title gs-truncate">{`${t.title} · ${b.season.label}`}</h3>
        {rounds.length === 0 ? (
          <EmptyState>{t.empty}</EmptyState>
        ) : narrow ? (
          <>
            <div className="gs-seg" data-gs-rounds="" role="group" aria-label={t.rounds}>
              {rounds.map((r, i) => (
                <button
                  key={`${r.stage_id}-${r.kind}-${i}`}
                  type="button"
                  aria-pressed={i === active}
                  onClick={() => setPicked(i)}
                >
                  {r.name}
                </button>
              ))}
            </div>
            <ul className="gs-bracket-list">
              {rounds[active]!.ties.map((tie) => (
                <li key={tie.id}>
                  <TieBox tie={tie} {...show} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="gs-bracket">
            {rounds.map((r, i) => (
              <section key={`${r.stage_id}-${r.kind}-${i}`} className="gs-bracket-round" data-kind={r.kind}>
                <h4 className="gs-group-title gs-truncate">{r.name}</h4>
                <ul className="gs-bracket-ties">
                  {r.ties.map((tie) => (
                    <li key={tie.id}>
                      <TieBox tie={tie} {...show} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}

type Side = 'home' | 'away';

/** Gols (pontos) do lado do confronto numa partida: o mando pode ter trocado na volta. */
function legScore(tie: GsBracketTie, leg: GsBracketTie['legs'][number], side: Side): number | null {
  const team = tie[side];
  if (!team) return null;
  const atHome = leg.home_id === team.id;
  return atHome ? leg.score.home : leg.score.away;
}

const started = (status: GsBracketTie['legs'][number]['status']) =>
  status === 'finished' || LIVE_STATUSES.has(status);

function legLabel(tie: GsBracketTie, leg: number, t: WidgetTexts['bracket']): string | null {
  if (tie.format === 'two_legs') return leg === 1 ? t.firstLeg : leg === 2 ? t.secondLeg : null;
  if (tie.format === 'series') return t.game.replace('{n}', String(leg));
  return null;
}

function TieBox({
  tie,
  showAggregate,
  showLegs,
  showDates,
  highlightTeamId,
}: {
  tie: GsBracketTie;
  showAggregate: boolean;
  showLegs: boolean;
  showDates: boolean;
  highlightTeamId: string | undefined;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.bracket;
  const fmt = useFormatters();
  const live = tie.legs.some((l) => LIVE_STATUSES.has(l.status));
  const next = tie.legs.find((l) => l.status !== 'finished' && l.status !== 'cancelled');
  const highlight =
    !!highlightTeamId && (tie.home?.id === highlightTeamId || tie.away?.id === highlightTeamId);

  const line = (side: Side) => {
    const team = tie[side];
    const won = !!team && tie.winner_id === team.id;
    const lost = !!tie.winner_id && !!team && !won;
    const played = tie.legs.filter((l) => started(l.status));
    let main: number | null = null;
    let legs: (number | null)[] = [];
    if (tie.format === 'series') main = played.length ? (tie.wins?.[side] ?? null) : null;
    else if (tie.format === 'single') main = played[0] ? legScore(tie, played[0], side) : null;
    else {
      if (showAggregate) main = tie.aggregate?.[side] ?? null;
      if (showLegs || !showAggregate) legs = played.map((l) => legScore(tie, l, side));
    }
    const pens = tie.penalties?.[side];
    const name = team ? (team.short_name ?? team.name) : t.tbd;
    return (
      <div className="gs-tie-line" data-won={won || undefined} data-lost={lost || undefined}>
        <Crest src={team?.logo} name={team?.name ?? t.tbd} size="xs" />
        <span className="gs-truncate" title={team?.name}>
          {name}
        </span>
        {won ? <span className="gs-sr-only">{` (${t.advanced})`}</span> : null}
        <span className="gs-tie-score">
          {legs.map((g, i) => (
            <small key={i}>{g ?? '–'}</small>
          ))}
          {pens != null ? <small>{`(${pens} ${t.penaltiesShort})`}</small> : null}
          {main != null ? <strong>{main}</strong> : null}
        </span>
      </div>
    );
  };

  const meta: string[] = [];
  if (tie.format === 'series' && tie.wins) meta.push(t.series);
  else if (tie.format === 'two_legs' && showAggregate && tie.aggregate) meta.push(t.aggregate);
  if (live) meta.push(texts.status.live);
  else if (showDates && next && tie.status !== 'decided') {
    const label = legLabel(tie, next.leg, t);
    meta.push(label ? `${label} · ${fmt.dateTime(next.starts_at)}` : fmt.dateTime(next.starts_at));
  }

  return (
    <article
      className="gs-tie"
      data-status={tie.status}
      data-live={live || undefined}
      data-highlight={highlight || undefined}
    >
      {line('home')}
      {line('away')}
      {meta.length ? (
        <div className="gs-tie-meta">
          {meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
