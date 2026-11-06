'use client';

import { fillText, type WidgetLocale } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface ChampionsGalleryProps {
  /** UUID ou slug da competição. */
  competitionId: string;
  /** Quantas edições listar, da mais recente para trás (padrão 10; 0 = todas). */
  limit?: number | undefined;
  /** Ranking de quem tem mais títulos (padrão: sim; só aparece com a lista de campeões completa). */
  showRanking?: boolean | undefined;
  /** Quantos times no ranking (padrão 5; 0 = todos). */
  rankingLimit?: number | undefined;
  /** Vice de cada edição (padrão: não; busca o vice na mesma rota). */
  showRunnerUp?: boolean | undefined;
}

/** Time da galeria (`ParticipantRef` da API). */
interface GsChampionTeam {
  id: string;
  name: string;
  short_name: string | null;
  logo: string | null;
}

/** Resposta de `/v1/competitions/{id}/champions`, só o que o widget usa. */
interface GsChampions {
  competition: { id: string; slug: string; sport: string; name: string; logo: string | null };
  editions: {
    season_year: number;
    season_label: string;
    champion: GsChampionTeam | null;
    runner_up: GsChampionTeam | null;
  }[];
  total_editions: number;
  ranking: { rank: number; participant: GsChampionTeam; titles: number; seasons: string[] }[];
  ranking_complete: boolean;
}

const TEXTS: Record<
  WidgetLocale,
  {
    title: string;
    runnerUp: string;
    ranking: string;
    titleOne: string;
    titleMany: string;
    empty: string;
    /** "Últimas {n} de {total} edições". */
    shown: string;
  }
> = {
  'pt-BR': {
    title: 'Galeria de campeões',
    runnerUp: 'Vice: {name}',
    ranking: 'Mais títulos',
    titleOne: '1 título',
    titleMany: '{n} títulos',
    empty: 'Ainda não temos a lista de campeões desta competição.',
    shown: 'Últimas {n} de {total} edições',
  },
  es: {
    title: 'Galería de campeones',
    runnerUp: 'Subcampeón: {name}',
    ranking: 'Más títulos',
    titleOne: '1 título',
    titleMany: '{n} títulos',
    empty: 'Todavía no tenemos la lista de campeones de esta competición.',
    shown: 'Últimas {n} de {total} ediciones',
  },
  en: {
    title: 'Roll of honour',
    runnerUp: 'Runner-up: {name}',
    ranking: 'Most titles',
    titleOne: '1 title',
    titleMany: '{n} titles',
    empty: 'We don’t have the list of champions for this competition yet.',
    shown: 'Latest {n} of {total} editions',
  },
};

const REFRESH_MS = 24 * 60 * 60_000;

/**
 * Galeria de campeões: quem ganhou cada edição, da mais recente para trás, com o escudo (e o vice, se
 * ligado), e o ranking de quem tem mais títulos. Vale para qualquer competição com lista de campeões.
 */
export function ChampionsGallery({
  competitionId,
  limit = 10,
  showRanking = true,
  rankingLimit = 5,
  showRunnerUp = false,
}: ChampionsGalleryProps) {
  const { locale } = useGalaxieWidget();
  const t = TEXTS[locale] ?? TEXTS['pt-BR'];
  const query = useGalaxieQuery<GsChampions>(
    competitionId ? `/v1/competitions/${encodeURIComponent(competitionId)}/champions` : null,
    showRunnerUp ? { runner_up: 'true' } : {},
    () => REFRESH_MS,
  );
  const data = query.data;
  if (!data) {
    return (
      <WidgetFrame kind="champions_gallery" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  // edição cujo vencedor não está no catálogo fica fora da lista (sem nome para mostrar)
  const editions = data.editions.filter((e) => e.champion);
  const shown = limit > 0 ? editions.slice(0, limit) : editions;
  const ranking =
    showRanking && data.ranking_complete
      ? data.ranking.slice(0, rankingLimit > 0 ? rankingLimit : undefined)
      : [];
  return (
    <WidgetFrame kind="champions_gallery">
      <header className="gs-header">
        <Crest src={data.competition.logo} name={data.competition.name} size="sm" />
        <h3 className="gs-title gs-truncate">{data.competition.name}</h3>
        <span className="gs-spacer" />
        <span className="gs-muted gs-small">{t.title}</span>
      </header>
      {shown.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <ol className="gs-list" data-gs-champions="">
          {shown.map((e) => {
            const champion = e.champion!;
            return (
              <li key={e.season_year} className="gs-fixture" data-gs-season={e.season_year}>
                <span className="gs-fixture-date gs-strong">{e.season_label}</span>
                <span className="gs-grow" style={{ minWidth: 0 }}>
                  <span className="gs-line">
                    <Crest src={champion.logo} name={champion.name} size="xs" />
                    <span className="gs-truncate gs-strong">{champion.name}</span>
                  </span>
                  {showRunnerUp && e.runner_up ? (
                    <span className="gs-line gs-meta" data-gs-runner-up="">
                      <Crest src={e.runner_up.logo} name={e.runner_up.name} size="xs" />
                      <span className="gs-truncate">{fillText(t.runnerUp, { name: e.runner_up.name })}</span>
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {ranking.length > 0 ? (
        <div className="gs-group" data-gs-champions-ranking="">
          <div className="gs-group-title">{t.ranking}</div>
          <table className="gs-table">
            <tbody>
              {ranking.map((r) => (
                <tr key={r.participant.id}>
                  <td className="gs-left gs-rank">{r.rank}</td>
                  <td className="gs-left">
                    <div className="gs-line">
                      <Crest src={r.participant.logo} name={r.participant.name} size="xs" />
                      <span className="gs-truncate gs-strong">{r.participant.name}</span>
                    </div>
                  </td>
                  <td className="gs-strong" title={r.seasons.join(', ')}>
                    {r.titles === 1 ? t.titleOne : fillText(t.titleMany, { n: r.titles })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {shown.length > 0 && shown.length < editions.length ? (
        <footer className="gs-footer">
          <span>{fillText(t.shown, { n: shown.length, total: editions.length })}</span>
        </footer>
      ) : null}
    </WidgetFrame>
  );
}
