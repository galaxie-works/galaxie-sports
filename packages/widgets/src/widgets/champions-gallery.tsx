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
    champion: string;
    runnerUpLabel: string;
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
    champion: 'Campeão',
    runnerUpLabel: 'Vice',
    runnerUp: 'Vice: {name}',
    ranking: 'Mais títulos',
    titleOne: '1 título',
    titleMany: '{n} títulos',
    empty: 'Ainda não temos a lista de campeões desta competição.',
    shown: 'Últimas {n} de {total} edições',
  },
  es: {
    title: 'Galería de campeones',
    champion: 'Campeón',
    runnerUpLabel: 'Subcampeón',
    runnerUp: 'Subcampeón: {name}',
    ranking: 'Más títulos',
    titleOne: '1 título',
    titleMany: '{n} títulos',
    empty: 'Todavía no tenemos la lista de campeones de esta competición.',
    shown: 'Últimas {n} de {total} ediciones',
  },
  en: {
    title: 'Roll of honour',
    champion: 'Champion',
    runnerUpLabel: 'Runner-up',
    runnerUp: 'Runner-up: {name}',
    ranking: 'Most titles',
    titleOne: '1 title',
    titleMany: '{n} titles',
    empty: 'We don’t have the list of champions for this competition yet.',
    shown: 'Latest {n} of {total} editions',
  },
};

const REFRESH_MS = 24 * 60 * 60_000;

/** Cores dos troféus (o tema pode trocar com `--gs-trophy-gold` e `--gs-trophy-silver`). */
const TROPHY_COLORS = {
  gold: 'var(--gs-trophy-gold, #d4a017)',
  silver: 'var(--gs-trophy-silver, #a7adb4)',
} as const;

/** Troféu (desenho do ícone `trophy` do Lucide), dourado para o campeão e prateado para o vice. */
function Trophy({ tone, label }: { tone: keyof typeof TROPHY_COLORS; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      data-gs-trophy={tone}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={TROPHY_COLORS[tone]}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <title>{label}</title>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" fill={TROPHY_COLORS[tone]} fillOpacity="0.25" />
    </svg>
  );
}

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
                  <span className="gs-line" data-gs-champion="">
                    <Trophy tone="gold" label={t.champion} />
                    <Crest src={champion.logo} name={champion.name} size="xs" />
                    <span className="gs-truncate gs-strong">{champion.name}</span>
                  </span>
                  {showRunnerUp && e.runner_up ? (
                    <span className="gs-line gs-meta" data-gs-runner-up="">
                      <Trophy tone="silver" label={t.runnerUpLabel} />
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
