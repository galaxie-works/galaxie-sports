'use client';

import type { ReactNode } from 'react';

import {
  fillText,
  type GsHomeAwayTotal,
  type GsMinuteRange,
  type GsScoreLine,
  type GsTeam,
  type GsTeamStatistics,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatGrid,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface TeamStatsProps {
  /** Id do time na API Galaxie. */
  teamId: string;
  /** Campeonato (UUID ou slug). Sem ele, o da temporada em que o time mais jogou. */
  competitionId?: string | undefined;
  /** Ano da temporada. Sem ele, a mais recente com estatísticas. */
  season?: number | undefined;
  /** Jogos, vitórias, empates, derrotas e gols (padrão: sim). */
  showSummary?: boolean | undefined;
  /** Forma: os últimos resultados com V/E/D (padrão: sim). */
  showForm?: boolean | undefined;
  /** Quantos resultados na forma (1 a 10, padrão 5). */
  formCount?: number | undefined;
  /** Os números em casa e fora, lado a lado (padrão: sim). */
  showHomeAway?: boolean | undefined;
  /** Gols marcados e sofridos por faixa de minuto (padrão: sim). */
  showGoalsByMinute?: boolean | undefined;
  /** Maiores sequências, maior vitória e derrota, e pênaltis (padrão: sim). */
  showHighlights?: boolean | undefined;
  /** Formações mais usadas (padrão: sim). */
  showFormations?: boolean | undefined;
  /** Amarelos e vermelhos por faixa de minuto (padrão: não). */
  showCards?: boolean | undefined;
}

/** O agregado é renovado a cada 7 dias (tier 1) ou 14 (demais): reler a cada 6 h basta. */
const REFRESH_MS = 6 * 60 * 60_000;
const FORM_MAX = 10;
const FORMATIONS_SHOWN = 3;

/**
 * Estatísticas do time na temporada (`/v1/teams/{id}/statistics`): resumo, forma, casa e fora, gols por faixa de
 * minuto, sequências e maiores placares, formações e cartões. Cada bloco liga e desliga no Builder; sem o dado
 * (esporte ainda sem estatísticas, temporada não coletada), um estado vazio claro.
 */
export function TeamStats({
  teamId,
  competitionId,
  season,
  showSummary = true,
  showForm = true,
  formCount = 5,
  showHomeAway = true,
  showGoalsByMinute = true,
  showHighlights = true,
  showFormations = true,
  showCards = false,
}: TeamStatsProps) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.teamStats;
  const id = teamId ? encodeURIComponent(teamId) : null;
  const query = useGalaxieQuery<GsTeamStatistics>(
    id ? `/v1/teams/${id}/statistics` : null,
    { competition: competitionId || undefined, season },
    () => REFRESH_MS,
  );
  const team = useGalaxieQuery<GsTeam>(id ? `/v1/teams/${id}` : null, {}, () => REFRESH_MS);
  const s = query.data?.data ?? null;

  const header = (
    <header className="gs-header">
      {team.data ? <Crest src={team.data.logo} name={team.data.name} size="sm" /> : null}
      <span className="gs-grow" style={{ minWidth: 0 }}>
        <h3 className="gs-title gs-truncate">{team.data ? team.data.name : t.title}</h3>
        {s ? (
          <span className="gs-meta gs-truncate" style={{ display: 'block' }}>
            {[s.competition.name, s.season.label].join(' · ')}
          </span>
        ) : null}
      </span>
      {s?.competition.logo ? <Crest src={s.competition.logo} name={s.competition.name} size="sm" /> : null}
    </header>
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="team_stats" busy={query.loading}>
        {header}
        {query.loading ? (
          <LoadingState lines={8} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  if (!s) {
    return (
      <WidgetFrame kind="team_stats">
        {header}
        <EmptyState>{t.empty}</EmptyState>
      </WidgetFrame>
    );
  }

  const n = (v: number | null | undefined) => (v == null ? null : fmt.integer(v));
  const count = Math.min(FORM_MAX, Math.max(1, Math.round(formCount)));
  // a API manda do mais recente ao mais antigo; lê-se da esquerda (antigo) para a direita (último)
  const form = [...(s.form ?? '').slice(0, count)].reverse();
  const average = s.goals.scored_average.total;
  const conceded = s.goals.conceded_average.total;
  const homeAwayRows = (
    [
      [t.played, s.record.played],
      [t.won, s.record.won],
      [t.drawn, s.record.drawn],
      [t.lost, s.record.lost],
      [t.goalsFor, s.goals.scored],
      [t.goalsAgainst, s.goals.conceded],
      [t.cleanSheets, s.clean_sheets],
      [t.failedToScore, s.failed_to_score],
    ] as [string, GsHomeAwayTotal][]
  ).filter(([, v]) => v.home != null || v.away != null);
  const highlights = (
    [
      [t.winStreak, n(s.streaks.wins)],
      [t.drawStreak, n(s.streaks.draws)],
      [t.lossStreak, n(s.streaks.losses)],
      [t.biggestWin, biggest(s.biggest.win, t)],
      [t.biggestLoss, biggest(s.biggest.loss, t)],
      [
        t.penalties,
        s.penalties.total
          ? fillText(t.penaltiesScored, { scored: s.penalties.scored ?? 0, total: s.penalties.total })
          : null,
      ],
    ] as [string, string | null][]
  ).filter(([, v]) => v);
  const formations = s.formations.slice(0, FORMATIONS_SHOWN);

  return (
    <WidgetFrame kind="team_stats">
      {header}

      {showSummary ? (
        <div className="gs-group" data-gs-block="summary">
          <div className="gs-group-title">{t.summary}</div>
          <StatGrid
            items={[
              [t.played, n(s.record.played.total)],
              [t.won, n(s.record.won.total)],
              [t.drawn, n(s.record.drawn.total)],
              [t.lost, n(s.record.lost.total)],
              [t.goalsFor, n(s.goals.scored.total)],
              [t.goalsAgainst, n(s.goals.conceded.total)],
            ]}
          />
          {average != null || conceded != null ? (
            <div className="gs-meta" style={{ textAlign: 'center' }}>
              {[
                average != null ? `${t.goalsFor}: ${fillText(t.perGame, { x: fmt.decimal(average) })}` : null,
                conceded != null
                  ? `${t.goalsAgainst}: ${fillText(t.perGame, { x: fmt.decimal(conceded) })}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {showForm && form.length ? (
        <div className="gs-group" data-gs-block="form">
          <div className="gs-group-title">{t.form}</div>
          <div className="gs-line" style={{ gap: 4, flexWrap: 'wrap' }} aria-label={t.form}>
            {form.map((r, i) => (
              <span key={i} className="gs-result" data-r={r}>
                {texts.schedule.result[r as 'W' | 'D' | 'L']}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showHomeAway && homeAwayRows.length ? (
        <div className="gs-group" data-gs-block="home-away">
          <div className="gs-group-title">{t.homeAway}</div>
          <div className="gs-statrow gs-meta">
            <span>{t.home}</span>
            <span />
            <span>{t.away}</span>
          </div>
          {homeAwayRows.map(([label, v]) => (
            <div key={label} className="gs-statrow">
              <span>{n(v.home) ?? '–'}</span>
              <span>{label}</span>
              <span>{n(v.away) ?? '–'}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showGoalsByMinute && (s.goals.scored_by_minute.length || s.goals.conceded_by_minute.length) ? (
        <div className="gs-group" data-gs-block="goals-by-minute">
          <div className="gs-group-title">{t.goalsByMinute}</div>
          <MinuteChart
            left={{ label: t.scored, side: 'for', ranges: s.goals.scored_by_minute }}
            right={{ label: t.conceded, side: 'against', ranges: s.goals.conceded_by_minute }}
          />
        </div>
      ) : null}

      {showHighlights && highlights.length ? (
        <div className="gs-group" data-gs-block="highlights">
          <div className="gs-group-title">{t.highlights}</div>
          <div>
            {highlights.map(([label, value]) => (
              <div key={label} className="gs-kv">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showFormations && formations.length ? (
        <div className="gs-group" data-gs-block="formations">
          <div className="gs-group-title">{t.formations}</div>
          <div>
            {formations.map((f) => (
              <div key={f.formation} className="gs-kv">
                <span>{f.formation}</span>
                <strong>{fillText(t.games, { n: fmt.integer(f.played) })}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showCards && (s.cards.yellow_by_minute.length || s.cards.red_by_minute.length) ? (
        <div className="gs-group" data-gs-block="cards">
          <div className="gs-group-title">{t.cards}</div>
          <MinuteChart
            left={{ label: t.yellow, side: 'yellow', ranges: s.cards.yellow_by_minute }}
            right={{ label: t.red, side: 'red', ranges: s.cards.red_by_minute }}
          />
        </div>
      ) : null}

      <div className="gs-meta">{fillText(t.updated, { date: fmt.date(s.updated_at) })}</div>
    </WidgetFrame>
  );
}

/** "3 × 0 (casa)": o maior placar entre casa e fora (mais saldo, depois mais gols do time). */
function biggest(
  pair: { home: GsScoreLine | null; away: GsScoreLine | null },
  t: { home: string; away: string },
): string | null {
  const options = (
    [
      [pair.home, t.home],
      [pair.away, t.away],
    ] as [GsScoreLine | null, string][]
  ).filter((o): o is [GsScoreLine, string] => o[0] !== null);
  if (!options.length) return null;
  const margin = (s: GsScoreLine) => Math.abs(s.for - s.against);
  const [best, where] = options.reduce((a, b) =>
    margin(b[0]) > margin(a[0]) || (margin(b[0]) === margin(a[0]) && b[0].for > a[0].for) ? b : a,
  );
  return `${best.for} × ${best.against} (${where.toLowerCase()})`;
}

interface Series {
  label: string;
  side: 'for' | 'against' | 'yellow' | 'red';
  ranges: GsMinuteRange[];
}

/** Duas séries por faixa de minuto, lado a lado, com a barra proporcional ao maior valor dos dois lados. */
function MinuteChart({ left, right }: { left: Series; right: Series }) {
  const { texts } = useGalaxieWidget();
  const t = texts.teamStats;
  const key = (r: GsMinuteRange) => `${r.from ?? 'x'}-${r.to ?? 'x'}`;
  const rows = new Map<string, GsMinuteRange>();
  for (const r of [...left.ranges, ...right.ranges]) rows.set(key(r), { ...r, count: 0 });
  const ordered = [...rows.values()].sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity));
  const valueOf = (list: GsMinuteRange[], r: GsMinuteRange) =>
    list.find((x) => key(x) === key(r))?.count ?? 0;
  const max = Math.max(1, ...left.ranges.map((r) => r.count), ...right.ranges.map((r) => r.count));
  const bar = (s: Series, r: GsMinuteRange) => {
    const v = valueOf(s.ranges, r);
    return (
      <span className="gs-mbar" data-side={s.side} data-zero={v === 0 || undefined}>
        <span style={{ width: `${Math.round((v / max) * 100)}%` }} />
        <span>{v}</span>
      </span>
    );
  };
  return (
    <div className="gs-minutes">
      <span />
      <span className="gs-meta">{left.label}</span>
      <span className="gs-meta">{right.label}</span>
      {ordered.map((r) => (
        <MinuteRow
          key={key(r)}
          label={r.from == null ? t.unknownMinute : fillText(t.minuteRange, { from: r.from, to: r.to ?? '' })}
        >
          {bar(left, r)}
          {bar(right, r)}
        </MinuteRow>
      ))}
    </div>
  );
}

function MinuteRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="gs-meta">{label}</span>
      {children}
    </>
  );
}
