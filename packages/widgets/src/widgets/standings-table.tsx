'use client';

import type { CSSProperties } from 'react';

import type { GsStandingRow, GsStandings, StandingsZoneColors, WidgetTexts } from '../core/model.js';
import { standingsZoneColor, standingsZoneLabel, standingsZoneTone } from '../core/model.js';
import {
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
}: StandingsTableProps) {
  const { texts } = useGalaxieWidget();
  const query = useGalaxieQuery<GsStandings>(
    competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/seasons/${season ?? 'current'}/standings`
      : null,
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

  const groups = query.data.groups.filter((g) => g.rows.length > 0);
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
                    <th scope="col">{c.goalDiff}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown(group.rows).map((row) => (
                    <Row key={row.participant.id} row={row} texts={texts} zoneColors={zoneColors} />
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
}: {
  row: GsStandingRow;
  texts: WidgetTexts;
  zoneColors: StandingsZoneColors | undefined;
}) {
  const zone = row.description?.trim() ? row.description : null;
  return (
    <tr>
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
      <td>{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
    </tr>
  );
}
