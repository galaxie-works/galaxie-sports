import type { Event } from '@galaxie/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { CountryFlag } from '@/components/sport/country-flag';
import { Crest } from '@/components/sport/crest';
import { EventCard } from '@/components/sport/event-card';
import { FilterChip } from '@/components/sport/filter-chip';
import { SeasonSelect } from '@/components/sport/season-select';
import { ScrollRow } from '@/components/sport/scroll-row';
import { ChampionshipTable, championshipOrder } from '@/components/sport/race';
import { RaceHub } from '@/components/sport/race-hub';
import { Section } from '@/components/sport/section';
import { StandingsTable } from '@/components/sport/standings-table';
import { UrlTabs } from '@/components/sport/url-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { competitionEventsRequest, competitionRequest, standingsRequest } from '@/lib/galaxie/api';
import { apiLocale, contentLocale } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { countryHref, sportParent } from '@/lib/navigation';

/** Título da aba do navegador (e do histórico): o nome da página, não só "Galaxie Sports". */
export async function competitionMetadata(id: string, source: DataSource): Promise<Metadata> {
  const { locale } = await getI18n();
  try {
    return { title: (await source.getCompetition(id, locale)).name };
  } catch {
    return {};
  }
}

/** Quantas temporadas (das mais recentes) a demo verifica e oferece. */
import type { DataSource } from '@/lib/galaxie/source';
import type { PageContentProps } from './types';

const MAX_SEASONS = 6;

interface Round {
  name: string;
  events: Event[];
}

/** Agrupa os jogos por rodada/fase, na ordem em que acontecem (`fallback` nomeia os jogos sem fase). */
function groupByRound(events: Event[], fallback: string): Round[] {
  const rounds = new Map<string, Event[]>();
  for (const e of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const name = e.stage?.name ?? fallback;
    rounds.set(name, [...(rounds.get(name) ?? []), e]);
  }
  return [...rounds].map(([name, evs]) => ({ name, events: evs }));
}

/** Status que não mudam mais (mesmo conjunto de TERMINAL_STATUSES em @galaxie/providers). */
const TERMINAL = new Set(['finished', 'postponed', 'cancelled', 'abandoned']);

/** Rodada em destaque: a primeira com jogo ainda por acontecer ou em andamento; senão, a última. */
function defaultRound(rounds: Round[]) {
  return rounds.find((r) => r.events.some((e) => !TERMINAL.has(e.status))) ?? rounds.at(-1);
}

/** Aba na URL (`?aba=jogos`): o link do jogo de volta para a competição abre direto nos jogos. */
const TAB_PARAM = 'aba';

/**
 * Competição única de uma família de esporte (a F1 em Automobilismo): o hub dela é a própria página da
 * família, com o título do menu, na rota da família (os filtros de temporada ficam nela).
 */
export interface CompetitionMount {
  basePath: string;
  title: string;
}

export async function CompetitionContent({
  params,
  searchParams,
  source,
  mount,
}: PageContentProps & { mount?: CompetitionMount }) {
  const { id } = await params;
  const query = await searchParams;
  const { locale, t } = await getI18n();
  const tc = t.pages.competition;
  const first = await source.getCompetition(id, locale);
  // nomes, fases e tags na voz do país da competição (Primera División do Chile em es-CL); continentais
  // (sem país) ficam no espanhol padrão; em pt-BR, tudo em português
  const content = contentLocale(locale, first.country?.code);
  const competition = content === apiLocale(locale) ? first : await source.getCompetition(id, content);

  const allWindows = competition.seasons
    .filter((s) => s.start_date && s.end_date)
    .sort((a, b) => b.year - a.year)
    .map((s) => ({ year: s.year, start: s.start_date!, end: s.end_date! }));
  // `?data=` (link vindo de um jogo): a temporada que contém a data do jogo
  const date = typeof query.data === 'string' ? query.data : null;
  const dated = date ? allWindows.find((w) => w.start <= date && date <= w.end)?.year : undefined;
  const requested = Number(query.temporada) || dated;
  // as mais recentes e, se pedida, uma temporada antiga (ex.: F1 de 1988, a partir do card de campeonato)
  const windows = allWindows.filter((w, i) => i < MAX_SEASONS || w.year === requested);
  const available = await source.getSeasonsWithData(competition.id, windows, content);
  // Sem escolha explícita: a temporada mais recente com classificação (a mais completa para a demo).
  const selected =
    available.find((s) => s.year === requested) ??
    available.find((s) => s.hasStandings) ??
    available.find((s) => s.year === competition.current_season?.year) ??
    available[0];
  const window = windows.find((w) => w.year === selected?.year);

  const [standings, events] =
    selected && window
      ? await Promise.all([
          selected.hasStandings ? source.getStandings(competition.id, selected.year, content) : null,
          source.getCompetitionEvents(competition.id, window.start, window.end, content),
        ])
      : [null, [] as Event[]];

  const rounds = groupByRound(events, tc.matches);
  const round = rounds.find((r) => r.name === query.rodada) ?? defaultRound(rounds);
  // F1: campeonatos de pilotos e de construtores no lugar da tabela de pontos corridos; GPs com sessões
  const championship = (standings?.groups ?? []).some(
    (g) => g.name === 'drivers' || g.name === 'constructors',
  );
  const sessions = events.some((e) => !!e.session);
  const groups = (
    championship ? championshipOrder(standings?.groups ?? []) : (standings?.groups ?? [])
  ).filter((g) => g.rows.length > 0);
  const base = mount?.basePath ?? `/competicoes/${competition.slug}`;
  const seasonQuery = selected ? `temporada=${selected.year}` : '';
  const tab = query[TAB_PARAM] === 'jogos' || !groups.length ? 'jogos' : 'classificacao';
  const sport = sportParent(competition.sport, t);
  const country = competition.country ? countryHref(competition.country.code) : null;

  return (
    <>
      {mount ? (
        // é a página da família no menu: abre trilha nova, como as outras páginas de esporte
        <PageHeader title={mount.title} kind="esporte" api={competitionRequest(id, locale, content)} />
      ) : (
        <PageHeader
          title={competition.name}
          kind="competição"
          parents={sport ? [sport] : undefined}
          api={competitionRequest(id, locale, content)}
        />
      )}
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {competition.logo_source === 'commons' && competition.logo ? (
            // logo da Commons (a F1): marca horizontal, sem a moldura quadrada dos escudos
            <img
              src={competition.logo}
              alt={competition.name}
              draggable={false}
              className="h-14 w-auto max-w-56 self-start object-contain sm:self-center"
            />
          ) : (
            <Crest src={competition.logo} name={competition.name} size="xl" />
          )}
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{competition.name}</h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{t.sport.competitionType[competition.type] ?? competition.type}</Badge>
              {championship && selected ? (
                <span>
                  {fill(t.race.season.title, {
                    year: competition.seasons.find((x) => x.year === selected.year)?.label ?? selected.year,
                  })}
                </span>
              ) : null}
              {competition.country && country ? (
                <Link href={country} className="inline-flex items-center gap-1.5 hover:underline">
                  <CountryFlag code={competition.country.code} />
                  {competition.country.name}
                </Link>
              ) : competition.country && competition.country.code !== 'WORLD' ? (
                // mundiais (F1) não têm país: "World" não diz nada a mais
                <span className="inline-flex items-center gap-1.5">
                  <CountryFlag code={competition.country.code} />
                  {competition.country.name}
                </span>
              ) : null}
              {competition.official_name && competition.official_name !== competition.name ? (
                <span>· {fill(tc.officialName, { name: competition.official_name })}</span>
              ) : null}
              {competition.trophy_nickname ? (
                <span>· {fill(tc.trophy, { name: competition.trophy_nickname })}</span>
              ) : null}
            </div>
            {competition.logo_credit ? (
              <a
                href={competition.logo_credit.page_url}
                target="_blank"
                rel="noreferrer"
                title={tc.hub.logoCredit}
                className="text-muted-foreground w-fit text-xs hover:underline"
              >
                {competition.logo_credit.text}
              </a>
            ) : null}
            {competition.nicknames.length ? (
              <div className="flex flex-wrap gap-1.5">
                {competition.nicknames.map((n) => (
                  <Badge key={n} variant="primary-light" radius="full">
                    {n}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {available.length === 0 ? (
          <EmptyState title={tc.noData.title} description={tc.noData.description} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tc.season}>
              <span className="text-muted-foreground text-xs" aria-hidden>
                {tc.season}
              </span>
              {available.map((s) => (
                <FilterChip
                  key={s.year}
                  href={`${base}?temporada=${s.year}`}
                  active={s.year === selected?.year}
                  keep={[TAB_PARAM]}
                >
                  {competition.seasons.find((x) => x.year === s.year)?.label ?? s.year}
                </FilterChip>
              ))}
              {allWindows.length > windows.length ? (
                // temporadas antigas (F1 desde 1950): todas no seletor, só a escolhida é conferida na API
                <SeasonSelect
                  options={allWindows.map((w) => ({
                    year: w.year,
                    label: competition.seasons.find((x) => x.year === w.year)?.label ?? String(w.year),
                    hint: '',
                    current: false,
                  }))}
                  value={selected?.year ?? allWindows[0]!.year}
                  basePath={base}
                  texts={{
                    label: t.team.season.label,
                    search: t.team.season.search,
                    empty: t.team.season.empty,
                    current: t.team.season.current,
                  }}
                />
              ) : null}
            </div>

            {championship ? (
              // F1: hub do campeonato (próximo GP, pilotos e construtores, calendário) no lugar das abas
              <RaceHub
                sport={competition.sport}
                events={events}
                groups={groups}
                focus={typeof query.rodada === 'string' ? query.rodada : null}
                current={selected?.year === competition.current_season?.year}
                standingsApi={
                  selected ? standingsRequest(competition.id, selected.year, locale, content) : undefined
                }
                eventsApi={
                  window
                    ? competitionEventsRequest(competition.id, window.start, window.end, locale, content)
                    : undefined
                }
              />
            ) : (
              <UrlTabs key={selected?.year} param={TAB_PARAM} value={tab}>
                <TabsList>
                  <TabsTrigger value="classificacao" disabled={!groups.length}>
                    {tc.standings}
                  </TabsTrigger>
                  {/* F1: a aba das sessões se chama "Corridas" (a URL segue `?aba=jogos`) */}
                  <TabsTrigger value="jogos">{sessions ? tc.races : tc.matches}</TabsTrigger>
                </TabsList>

                <TabsContent value="classificacao" className="flex flex-col gap-6 pt-4">
                  {groups.map((g) => (
                    <Section
                      key={g.name ?? 'geral'}
                      title={
                        championship && g.name
                          ? (t.race.championship[g.name] ?? g.name)
                          : // nome da API: o do regulamento ("Apertura · Zona A") ou o reservado ("Tabela anual")
                            (g.display_name ?? (groups.length > 1 && g.name ? g.name : tc.standings))
                      }
                      api={
                        selected
                          ? standingsRequest(competition.id, selected.year, locale, content)
                          : undefined
                      }
                    >
                      {championship ? (
                        <ChampionshipTable group={g} />
                      ) : (
                        <StandingsTable rows={g.rows} sport={competition.sport} />
                      )}
                    </Section>
                  ))}
                </TabsContent>

                <TabsContent value="jogos" className="flex flex-col gap-4 pt-4">
                  {rounds.length > 1 ? (
                    // a largura dos chips (45 cards de MMA, 24 GPs) não alarga a página: a fileira rola, sem barra nativa
                    <ScrollRow
                      className="gap-2 py-0.5"
                      label={tc.rounds}
                      previous={t.common.scrollPrevious}
                      next={t.common.scrollNext}
                    >
                      {rounds.map((r) => (
                        <FilterChip
                          key={r.name}
                          href={`${base}?${seasonQuery}&${TAB_PARAM}=jogos&rodada=${encodeURIComponent(r.name)}`}
                          active={r.name === round?.name}
                        >
                          {r.name}
                        </FilterChip>
                      ))}
                    </ScrollRow>
                  ) : null}
                  {round ? (
                    <Section
                      title={round.name}
                      description={plural(
                        locale,
                        round.events.length,
                        sessions ? t.race.sessions : tc.matchCount,
                      )}
                      api={
                        window
                          ? competitionEventsRequest(
                              competition.id,
                              window.start,
                              window.end,
                              locale,
                              content,
                            )
                          : undefined
                      }
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {round.events.map((e) => (
                          <EventCard key={e.id} event={e} showCompetition={false} />
                        ))}
                      </div>
                    </Section>
                  ) : (
                    <EmptyState title={tc.noMatches} />
                  )}
                </TabsContent>
              </UrlTabs>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function CompetitionFallback() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-4 w-40" />} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-24" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-96" />
      </div>
    </>
  );
}
