'use client';

import type { CSSProperties } from 'react';

import type {
  GsCompetitionContext,
  GsStandingRow,
  GsStandings,
  StandingsZoneColors,
  WidgetTexts,
} from '../core/model.js';
import { standingsZoneColor, standingsZoneLabel, standingsZoneTone } from '../core/model.js';
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
  /** Coluna de gols pró (padrão: não). */
  showGoalsFor?: boolean | undefined;
  /** Coluna de gols contra (padrão: não). */
  showGoalsAgainst?: boolean | undefined;
  /** Coluna de saldo de gols (padrão: sim). */
  showGoalDiff?: boolean | undefined;
  /** Forma recente, os últimos 5 jogos (padrão: não). */
  showForm?: boolean | undefined;
  /** Aproveitamento em % dos pontos disputados (padrão: não). */
  showPercentage?: boolean | undefined;
  /** UUID de um time para destacar a linha (o clube do portal, por exemplo). */
  highlightTeamId?: string | undefined;
  /** Líder e próximos jogos decisivos embaixo da tabela (padrão: não). */
  showDecisive?: boolean | undefined;
}

/** Colunas opcionais ligadas. */
interface Columns {
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
  showPercentage = false,
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
  const cols: Columns = {
    goalsFor: showGoalsFor,
    goalsAgainst: showGoalsAgainst,
    goalDiff: showGoalDiff,
    form: showForm,
    percentage: showPercentage,
  };
  const x = texts.extra;

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
                    <th scope="col">{c.points}</th>
                    <th scope="col">{c.played}</th>
                    <th scope="col">{c.won}</th>
                    <th scope="col">{c.drawn}</th>
                    <th scope="col">{c.lost}</th>
                    {cols.goalsFor ? <th scope="col">{x.goalsFor}</th> : null}
                    {cols.goalsAgainst ? <th scope="col">{x.goalsAgainst}</th> : null}
                    {cols.goalDiff ? <th scope="col">{c.goalDiff}</th> : null}
                    {cols.percentage ? <th scope="col">{x.percentage}</th> : null}
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
  highlight,
}: {
  row: GsStandingRow;
  texts: WidgetTexts;
  zoneColors: StandingsZoneColors | undefined;
  cols: Columns;
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
      <td className="gs-strong">{row.points}</td>
      <td>{row.played}</td>
      <td>{row.won}</td>
      <td>{row.drawn}</td>
      <td>{row.lost}</td>
      {cols.goalsFor ? <td>{row.goals_for ?? '–'}</td> : null}
      {cols.goalsAgainst ? <td>{row.goals_against ?? '–'}</td> : null}
      {cols.goalDiff ? <td>{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td> : null}
      {cols.percentage ? (
        <td>{row.played > 0 ? Math.round((row.points / (row.played * 3)) * 100) : '–'}</td>
      ) : null}
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
