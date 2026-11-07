'use client';

import type { GsCompetitionLeaders, GsLeaderCategory } from '../core/model.js';
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

export interface CompetitionLeadersProps {
  /** UUID ou slug da competição. */
  competitionId: string;
  /** Ano da temporada; padrão: a atual. */
  season?: number | 'current' | undefined;
  /** `goals` = artilharia (padrão), `assists` = assistências, `cards` = cartões. */
  category?: GsLeaderCategory | undefined;
  /** Até que posição (1–50, padrão 10); empatados com o último também aparecem (no máximo 50 linhas). */
  limit?: number | undefined;
  /** Foto do jogador (padrão: sim; sem foto, as iniciais). */
  showPhoto?: boolean | undefined;
  /** Escudo e nome do time embaixo do jogador (padrão: sim). */
  showTeam?: boolean | undefined;
  /** Coluna de jogos (padrão: sim). */
  showAppearances?: boolean | undefined;
  /** UUID de um time para destacar os jogadores dele (o clube do portal, por exemplo). */
  highlightTeamId?: string | undefined;
}

const LEADERS_REFRESH_MS = 30 * 60_000;

/** Artilharia e líderes do campeonato: posição, jogador com o escudo do time, jogos e o número da categoria. */
export function CompetitionLeaders({
  competitionId,
  season,
  category = 'goals',
  limit = 10,
  showPhoto = true,
  showTeam = true,
  showAppearances = true,
  highlightTeamId,
}: CompetitionLeadersProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.leaders;
  const fmt = useFormatters();
  const max = Math.min(50, Math.max(1, Math.round(limit) || 10));
  const query = useGalaxieQuery<GsCompetitionLeaders>(
    competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/seasons/${season ?? 'current'}/leaders`
      : null,
    { category, limit: max },
    () => LEADERS_REFRESH_MS,
  );
  const title = t[category];
  const d = query.data;
  if (!d) {
    return (
      <WidgetFrame kind="competition_leaders" busy={query.loading}>
        <h3 className="gs-title">{title}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const cards = category === 'cards';
  return (
    <WidgetFrame kind="competition_leaders">
      <header className="gs-header">
        <h3 className="gs-title">{title}</h3>
        <span className="gs-spacer" />
        <span>{d.season.label}</span>
      </header>
      {d.data.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <table className="gs-table" data-gs-leaders={category}>
          <thead>
            <tr>
              <th className="gs-left" scope="col">
                #
              </th>
              <th className="gs-left" scope="col">
                {t.player}
              </th>
              {showAppearances ? (
                <th scope="col">
                  <abbr title={t.appearancesLong}>{t.appearances}</abbr>
                </th>
              ) : null}
              {cards ? (
                <>
                  <th scope="col">
                    <span className="gs-card-yellow" role="img" aria-label={t.yellow} title={t.yellow} />
                  </th>
                  <th scope="col">
                    <span className="gs-card-red" role="img" aria-label={t.red} title={t.red} />
                  </th>
                </>
              ) : (
                <th scope="col">{category === 'goals' ? t.goalsCol : t.assistsCol}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {d.data.map((r) => (
              <tr
                key={r.person.id}
                className={highlightTeamId && r.team?.id === highlightTeamId ? 'gs-highlight' : undefined}
                data-gs-person={r.person.id}
              >
                <td className="gs-left gs-rank">{r.rank}</td>
                <td className="gs-left">
                  <div className="gs-line">
                    {showPhoto ? <Crest src={r.person.photo} name={r.person.name} size="sm" /> : null}
                    <div className="gs-grow" style={{ minWidth: 0 }}>
                      <div className="gs-truncate gs-strong">{r.person.name}</div>
                      {showTeam && r.team ? (
                        <div className="gs-leader-team">
                          <Crest src={r.team.logo} name={r.team.name} size="xs" />
                          <span className="gs-truncate">{r.team.short_name ?? r.team.name}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                {showAppearances ? <td>{r.appearances}</td> : null}
                {cards ? (
                  <>
                    <td className="gs-strong">{r.yellow_cards}</td>
                    <td className="gs-strong">{r.red_cards}</td>
                  </>
                ) : (
                  <td className="gs-strong">{r.value}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.updated_at && fmt.date(d.updated_at) ? (
        <footer className="gs-footer" data-gs-updated>
          <span>
            {t.updatedAt} {fmt.date(d.updated_at)}
          </span>
        </footer>
      ) : null}
    </WidgetFrame>
  );
}
