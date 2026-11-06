'use client';

import type { CSSProperties } from 'react';

import type {
  GsCompetitionContext,
  GsStandingRow,
  GsStandings,
  SportProfile,
  StandingsZoneColors,
  WidgetTexts,
} from '../core/model.js';
import {
  gamesBehind,
  sportProfile,
  standingPercentage,
  standingsZoneColor,
  standingsZoneLabel,
  standingsZoneTone,
  unitLabels,
} from '../core/model.js';
import {
  CompetitionSituation,
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface StandingsTableProps {
  /** UUID ou slug da competição. */
  competitionId: string;
  /** Ano da temporada; padrão: a atual. */
  season?: number | 'current' | undefined;
  /** Mostra só as primeiras N linhas de cada grupo. */
  limit?: number | undefined;
  /** Legenda das zonas (Libertadores, rebaixamento…) embaixo da tabela. Padrão: true. */
  showLegend?: boolean | undefined;
  /** Cor de cada faixa (`#rrggbb`); o que faltar usa a padrão (vaga direta = cor primária do tema). */
  zoneColors?: StandingsZoneColors | undefined;
  /** Qual tabela mostrar quando a temporada tem várias: `all` (padrão), `phase`, `annual`, `relegation_average`. */
  table?: 'all' | 'phase' | 'annual' | 'relegation_average' | undefined;
  /** Coluna de gols (pontos, corridas, sets) pró (padrão: não). */
  showGoalsFor?: boolean | undefined;
  /** Coluna de gols (pontos, corridas, sets) contra (padrão: não). */
  showGoalsAgainst?: boolean | undefined;
  /** Coluna de saldo (padrão: sim). */
  showGoalDiff?: boolean | undefined;
  /** Forma recente, os últimos 5 jogos (padrão: não). */
  showForm?: boolean | undefined;
  /**
   * Aproveitamento: % dos pontos disputados; % de vitórias no basquete, beisebol e futebol americano; o
   * percentual pró ÷ contra na AFL. Padrão: não. Onde a tabela é por vitórias e na AFL, sempre aparece.
   */
  showPercentage?: boolean | undefined;
  /** UUID de um time para destacar a linha (o clube do portal, por exemplo). */
  highlightTeamId?: string | undefined;
  /** Líder e próximos jogos decisivos embaixo da tabela (padrão: não). */
  showDecisive?: boolean | undefined;
}

/** Colunas ligadas (as opcionais e as que dependem do esporte). */
interface Columns {
  points: boolean;
  /** Beisebol: jogos atrás do líder. */
  gamesBehind: boolean;
  drawn: boolean;
  otLosses: boolean;
  goalsFor: boolean;
  goalsAgainst: boolean;
  goalDiff: boolean;
  form: boolean;
  percentage: boolean;
}

/** A tabela muda pouco: atualiza a cada 10 minutos. */
const STANDINGS_REFRESH_MS = 10 * 60_000;

/** Cor da faixa na variável `--gs-zone` (a borda do # e o ponto da legenda leem dela). */
const zoneStyle = (color: string) => ({ '--gs-zone': color }) as CSSProperties;

/**
 * Classificação da competição (um bloco por grupo), com cada zona numa cor (vaga direta, fase prévia,
 * segunda e terceira copa, playoff e rebaixamento) e a legenda embaixo.
 */
export function StandingsTable({
  competitionId,
  season,
  limit,
  showLegend = true,
  zoneColors,
  table = 'all',
  showGoalsFor = false,
  showGoalsAgainst = false,
  showGoalDiff = true,
  showForm = false,
  showPercentage,
  highlightTeamId,
  showDecisive = false,
}: StandingsTableProps) {
  const { texts } = useGalaxieWidget();
  const query = useGalaxieQuery<GsStandings>(
    competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/seasons/${season ?? 'current'}/standings`
      : null,
    {},
    () => STANDINGS_REFRESH_MS,
  );
  const context = useGalaxieQuery<GsCompetitionContext>(
    competitionId && showDecisive ? `/v1/competitions/${encodeURIComponent(competitionId)}/context` : null,
    {},
    () => STANDINGS_REFRESH_MS,
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="standings" busy={query.loading}>
        <h3 className="gs-title">{texts.standings}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const all = query.data.groups.filter((g) => g.rows.length > 0);
  // a tabela escolhida; sem nenhuma desse papel (campeonato sem regulamento de tabelas), todas
  const picked = table === 'all' ? all : all.filter((g) => g.table === table);
  const groups = picked.length ? picked : all;
  const c = texts.columns;
  const profile = sportProfile(query.data.sport);
  const rowsAll = groups.flatMap((g) => g.rows);
  // pró e contra zerados em todas as linhas (a NBA não manda): sem saldo nem percentual pró ÷ contra
  const hasScores = rowsAll.some((r) => (r.goals_for ?? 0) > 0 || (r.goals_against ?? 0) > 0);
  const cols: Columns = {
    points: profile.points,
    gamesBehind: profile.sport === 'baseball',
    // empate só aparece onde existe (no futebol americano, só se houve)
    drawn: profile.draws && (profile.sport === 'football' || rowsAll.some((r) => r.drawn > 0)),
    otLosses: profile.overtimeLosses && rowsAll.some((r) => r.ot_lost != null),
    goalsFor: showGoalsFor && hasScores,
    goalsAgainst: showGoalsAgainst && hasScores,
    goalDiff: showGoalDiff && (hasScores || profile.sport === 'football'),
    form: showForm,
    // tabela por vitórias e AFL: o % é a coluna que ordena, sempre visível; nos outros, opcional
    percentage: profile.percentage === 'ratio' ? hasScores : !profile.points || (showPercentage ?? false),
  };
  const u = unitLabels(profile.unit, texts);
  const x = texts.extra;
  const pctLabel =
    profile.percentage === 'wins'
      ? texts.sport.winPct
      : profile.percentage === 'ratio'
        ? texts.sport.ratio
        : x.percentage;
  const shown = (rows: GsStandingRow[]) => (limit ? rows.slice(0, limit) : rows);
  // legenda: uma entrada por zona (pelo nome exibido), na ordem em que aparece na tabela
  const legend = new Map<string, string>();
  if (showLegend) {
    for (const group of groups) {
      for (const row of shown(group.rows)) {
        if (!row.description?.trim()) continue;
        const label = standingsZoneLabel(row.description, texts.zones);
        if (legend.has(label)) continue;
        legend.set(label, standingsZoneColor(standingsZoneTone(row.description), zoneColors));
      }
    }
  }
  return (
    <WidgetFrame kind="standings">
      <header className="gs-header">
        <h3 className="gs-title">{texts.standings}</h3>
        <span className="gs-spacer" />
        <span>{query.data.season.label}</span>
      </header>
      {groups.length === 0 ? (
        <EmptyState>{texts.emptyStandings}</EmptyState>
      ) : (
        groups.map((group, i) => (
          <div key={group.name ?? i} className="gs-group">
            {groupTitle(group, groups.length) ? (
              <div className="gs-group-title">{groupTitle(group, groups.length)}</div>
            ) : null}
            <div className="gs-scroll">
              <table className="gs-table">
                <thead>
                  <tr>
                    <th className="gs-left" scope="col">
                      #
                    </th>
                    <th className="gs-left" scope="col">
                      {c.team}
                    </th>
                    {cols.points ? <th scope="col">{c.points}</th> : null}
                    <th scope="col">{c.played}</th>
                    <th scope="col">{c.won}</th>
                    {cols.drawn ? <th scope="col">{c.drawn}</th> : null}
                    <th scope="col">{c.lost}</th>
                    {cols.otLosses ? <th scope="col">{texts.sport.otLosses}</th> : null}
                    {cols.goalsFor ? <th scope="col">{u.for}</th> : null}
                    {cols.goalsAgainst ? <th scope="col">{u.against}</th> : null}
                    {cols.goalDiff ? <th scope="col">{u.diff}</th> : null}
                    {cols.percentage ? <th scope="col">{pctLabel}</th> : null}
                    {cols.gamesBehind ? <th scope="col">{texts.sport.gamesBehind}</th> : null}
                    {cols.form ? <th scope="col">{x.form}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {shown(group.rows).map((row) => (
                    <Row
                      key={row.participant.id}
                      row={row}
                      texts={texts}
                      zoneColors={zoneColors}
                      cols={cols}
                      profile={profile}
                      leader={group.rows[0]}
                      highlight={!!highlightTeamId && row.participant.id === highlightTeamId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      {legend.size > 0 ? (
        <ul className="gs-legend">
          {[...legend].map(([label, color]) => (
            <li key={label}>
              <span className="gs-legend-dot" style={zoneStyle(color)} />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {showDecisive && context.data ? <CompetitionSituation context={context.data} /> : null}
    </WidgetFrame>
  );
}

/**
 * Título do bloco: o nome exibido da API ("Apertura · Zona A", "Tabela anual", "Grupo A"); sem ele, o nome
 * do fornecedor só quando há mais de um grupo (numa tabela única, o nome da liga repetiria o cabeçalho).
 */
function groupTitle(group: GsStandings['groups'][number], count: number): string | null {
  return group.display_name ?? (count > 1 ? group.name : null);
}

function Row({
  row,
  texts,
  zoneColors,
  cols,
  profile,
  leader,
  highlight,
}: {
  row: GsStandingRow;
  texts: WidgetTexts;
  zoneColors: StandingsZoneColors | undefined;
  cols: Columns;
  profile: SportProfile;
  leader: GsStandingRow | undefined;
  highlight: boolean;
}) {
  const zone = row.description?.trim() ? row.description : null;
  const form = (row.form ?? '')
    .toUpperCase()
    .replace(/[^WDL]/g, '')
    .slice(-5);
  return (
    <tr className={highlight ? 'gs-highlight' : undefined}>
      <td
        className="gs-left gs-rank"
        data-zone={zone ? '' : undefined}
        style={zone ? zoneStyle(standingsZoneColor(standingsZoneTone(zone), zoneColors)) : undefined}
        title={zone ? standingsZoneLabel(zone, texts.zones) : undefined}
      >
        {row.rank}
      </td>
      <td className="gs-left">
        <div className="gs-line">
          <Crest src={row.participant.logo} name={row.participant.name} size="sm" />
          <span className="gs-truncate">{row.participant.short_name ?? row.participant.name}</span>
        </div>
      </td>
      {cols.points ? <td className="gs-strong">{row.points}</td> : null}
      <td>{row.played}</td>
      <td className={cols.points ? undefined : 'gs-strong'}>{row.won}</td>
      {cols.drawn ? <td>{row.drawn}</td> : null}
      <td>{row.lost}</td>
      {cols.otLosses ? <td>{row.ot_lost ?? '–'}</td> : null}
      {cols.goalsFor ? <td>{row.goals_for ?? '–'}</td> : null}
      {cols.goalsAgainst ? <td>{row.goals_against ?? '–'}</td> : null}
      {cols.goalDiff ? <td>{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td> : null}
      {cols.percentage ? <td>{standingPercentage(row, profile) ?? '–'}</td> : null}
      {cols.gamesBehind ? <td>{gamesBehind(row, leader)}</td> : null}
      {cols.form ? (
        <td>
          <span className="gs-form">
            {[...form].map((r, i) => (
              <span key={i} className="gs-result" data-r={r}>
                {texts.schedule.result[r as 'W' | 'D' | 'L']}
              </span>
            ))}
          </span>
        </td>
      ) : null}
    </tr>
  );
}
