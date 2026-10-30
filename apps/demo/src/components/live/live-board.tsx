'use client';

import type { Event } from '@galaxie/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { CalendarClock, CircleAlert, CircleCheck, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { CompetitionCountry } from '@/components/sport/competition-country';
import { Crest } from '@/components/sport/crest';
import { EventCardView } from '@/components/sport/event-card-view';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/hooks/use-hydrated';
import {
  fetchFinished,
  fetchLiveEvents,
  fetchUpcoming,
  finishedKey,
  fetchUpcomingSports,
  LIVE_EVENTS_KEY,
  relevanceOf,
  upcomingKey,
  UPCOMING_SPORTS_KEY,
  type UpcomingScope,
} from '@/lib/galaxie/live';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { Locale } from '@/lib/i18n/config';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import { SPORTS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { LiveFilterBar } from './live-filter-bar';
import {
  combineUpcoming,
  finishedWindowHours,
  groupUpcoming,
  hasLiveFilters,
  liveFilterOptions,
  liveFiltersSearch,
  matchesLiveFilters,
  parseLiveFilters,
  showsStatus,
  UPCOMING_FETCH_LIMIT,
  upcomingScopes,
  type LiveFilters,
  type UpcomingGroup,
} from './live-filters';
import { RefreshTimer } from './refresh-timer';
import { useLiveRefresh } from './use-live-refresh';

/** Próximos por esporte na tela: uma fileira com todos os esportes; mais quando o filtro deixa poucos. */
const UPCOMING_PER_SPORT = 3;
const UPCOMING_PER_SPORT_FEW = 6;
/**
 * Os próximos não mudam a cada lance: a lista de esportes vale 5 min e cada busca, 2 min. Nenhuma delas
 * entra na atualização do ao vivo (SSE e verificação periódica só tocam `LIVE_EVENTS_KEY`).
 */
const UPCOMING_SPORTS_STALE_MS = 5 * 60_000;
const UPCOMING_STALE_MS = 2 * 60_000;
/** Encerrados por busca (um esporte, um esporte num país ou uma competição), dos mais importantes. */
const FINISHED_FETCH_LIMIT = 24;
/** Encerrados com um esporte só escolhido: a lista inteira é dele. */
const FINISHED_FETCH_LIMIT_ONE_SPORT = 60;
/**
 * Os encerrados são refeitos a cada minuto enquanto a seção está aberta: o jogo que acaba de terminar sai do
 * ao vivo e entra aqui, e o que passou da janela sai (o início da janela é recalculado a cada busca).
 */
const FINISHED_REFRESH_MS = 60_000;

interface CompetitionGroup {
  key: string;
  competition: Event['competition'];
  score: number;
  events: Event[];
}

interface SportGroup {
  sport: string;
  label: string;
  icon: (typeof SPORTS)[number]['icon'] | null;
  score: number;
  competitions: CompetitionGroup[];
}

const byRelevance = (a: Event, b: Event) =>
  relevanceOf(b) - relevanceOf(a) ||
  Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
  a.id.localeCompare(b.id);

/** Agrupa por esporte e competição; grupos e jogos em ordem de relevância (a maior primeiro). */
export function groupLive(events: Event[], sportLabel: (slug: string) => string): SportGroup[] {
  const sports = new Map<string, Map<string, CompetitionGroup>>();
  for (const e of events) {
    const comps = sports.get(e.sport) ?? new Map<string, CompetitionGroup>();
    const key = e.competition?.id ?? 'sem-competicao';
    const g = comps.get(key) ?? { key, competition: e.competition, score: 0, events: [] };
    g.events.push(e);
    g.score = Math.max(g.score, relevanceOf(e));
    comps.set(key, g);
    sports.set(e.sport, comps);
  }
  return [...sports.entries()]
    .map(([sport, comps]) => {
      const nav = SPORTS.find((s) => s.slug === sport);
      const competitions = [...comps.values()]
        .map((c) => ({ ...c, events: [...c.events].sort(byRelevance) }))
        .sort(
          (a, b) => b.score - a.score || (a.competition?.name ?? '').localeCompare(b.competition?.name ?? ''),
        );
      return {
        sport,
        label: sportLabel(sport),
        icon: nav?.icon ?? null,
        score: Math.max(...competitions.map((c) => c.score)),
        competitions,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Cartão de jogo no navegador. Só aparece depois da hidratação (os dados vêm daqui), então pode usar o
 * fuso do próprio navegador.
 */
function ClientEventCard({ event }: { event: Event }) {
  const { locale, t } = useI18n();
  const f = useFormatters(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return <EventCardView event={event} locale={locale} t={t.sport} f={f} />;
}

/** Cartão que acende por alguns segundos quando o placar muda. */
function LiveCard({ event }: { event: Event }) {
  const score = `${event.score.home ?? '-'}:${event.score.away ?? '-'}`;
  const prev = useRef(score);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current === score) return;
    prev.current = score;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 4000);
    return () => clearTimeout(t);
  }, [score]);
  return (
    <div
      className={cn(
        'rounded-xl transition-shadow duration-700',
        flash && 'ring-primary shadow-primary/30 shadow-lg ring-2',
      )}
    >
      <ClientEventCard event={event} />
    </div>
  );
}

function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-44" />
      ))}
    </div>
  );
}

/** Jogos por esporte e competição (o país antes da liga), na ordem de `groupLive`. */
function GroupedEvents({
  groups,
  renderCard,
}: {
  groups: SportGroup[];
  renderCard: (e: Event) => React.ReactNode;
}) {
  const { t } = useI18n();
  const tb = t.live.board;
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => {
        const Icon = g.icon;
        return (
          <section key={g.sport} className="flex flex-col gap-4" aria-label={g.label}>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              {Icon ? <Icon className="size-4" aria-hidden /> : null}
              {g.label}
              <span className="text-muted-foreground text-sm font-normal tabular-nums">
                {g.competitions.reduce((n, c) => n + c.events.length, 0)}
              </span>
            </h3>
            {g.competitions.map((c) => (
              <div key={c.key} className="flex flex-col gap-2">
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  {/* o país antes da liga: "Croácia · First NL", "Israel · Liga Leumit" */}
                  {c.competition?.country ? (
                    <>
                      <CompetitionCountry
                        country={c.competition.country}
                        label
                        className="text-foreground font-medium"
                      />
                      <span aria-hidden>·</span>
                    </>
                  ) : null}
                  {c.competition ? (
                    <Link
                      href={`/competicoes/${c.competition.slug}`}
                      className="text-foreground flex items-center gap-2 font-medium hover:underline"
                    >
                      <Crest src={c.competition.logo} name={c.competition.name} size="xs" />
                      {c.competition.name}
                    </Link>
                  ) : (
                    <span>{tb.noCompetition}</span>
                  )}
                  <span className="tabular-nums">· {c.events.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {c.events.map(renderCard)}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Enquanto a página não lê a URL (os filtros): o mesmo esqueleto do carregamento. */
export function LiveBoardFallback() {
  return <CardsSkeleton count={6} />;
}

/**
 * Próximos apitos de todos os esportes: a agenda diz quais esportes têm jogo nos próximos dias e a página
 * busca os próximos de cada um em paralelo (poucos por esporte). Com país ou competição escolhidos, as
 * buscas já vão filtradas para a API. Ver `upcomingScopes`.
 */
function useUpcoming(locale: Locale, filters: LiveFilters) {
  const sportsQuery = useQuery({
    queryKey: UPCOMING_SPORTS_KEY,
    queryFn: () => fetchUpcomingSports(locale),
    staleTime: UPCOMING_SPORTS_STALE_MS,
  });
  const sports = useMemo(() => sportsQuery.data ?? [], [sportsQuery.data]);
  const { base, targeted } = useMemo(
    () =>
      upcomingScopes(
        filters,
        sports.map((s) => s.slug),
      ),
    [filters, sports],
  );
  const query = (scope: UpcomingScope) => ({
    queryKey: upcomingKey(scope),
    queryFn: () => fetchUpcoming(locale, scope, UPCOMING_FETCH_LIMIT),
    staleTime: UPCOMING_STALE_MS,
  });
  const baseResults = useQueries({ queries: base.map(query), combine: combineUpcoming });
  const targetedResults = useQueries({ queries: targeted.map(query), combine: combineUpcoming });
  const list = targeted.length ? targetedResults : baseResults;
  return {
    sports,
    /** Base das opções dos filtros: tudo que foi carregado. */
    loaded: [...baseResults.data, ...targetedResults.data],
    /** A lista da seção, antes do filtro no navegador. */
    list: list.data,
    loading: sportsQuery.isPending || (list.pending && !list.data.length),
    /** Alguma busca (a agenda ou os próximos da lista) falhou. */
    error: sportsQuery.isError || list.error,
    retry: () => {
      if (sportsQuery.isError) void sportsQuery.refetch();
      list.retry();
    },
  };
}

/**
 * Encerrados na janela escolhida (6 a 72 h), buscados só com "Encerrados" no filtro de status. Os recortes
 * são os dos próximos (um por esporte, ou já filtrados por país/competição), mas os esportes não saem só da
 * agenda: ela conta só o que ainda vai acontecer, e um esporte sem jogo marcado ficaria de fora. Entram todos
 * os esportes do menu, mais os da agenda.
 */
function useFinished(locale: Locale, filters: LiveFilters, agendaSports: string[], enabled: boolean) {
  const hours = finishedWindowHours(filters);
  const { base, targeted } = useMemo(
    () =>
      enabled
        ? upcomingScopes(filters, [...new Set([...SPORTS.map((s) => s.slug), ...agendaSports])])
        : { base: [], targeted: [] },
    [enabled, filters, agendaSports],
  );
  const limit = filters.sport.length === 1 ? FINISHED_FETCH_LIMIT_ONE_SPORT : FINISHED_FETCH_LIMIT;
  const query = (scope: UpcomingScope) => ({
    queryKey: [...finishedKey(scope, hours), limit],
    queryFn: () => fetchFinished(locale, scope, hours, limit),
    staleTime: FINISHED_REFRESH_MS,
    refetchInterval: FINISHED_REFRESH_MS,
  });
  const baseResults = useQueries({ queries: base.map(query), combine: combineUpcoming });
  const targetedResults = useQueries({ queries: targeted.map(query), combine: combineUpcoming });
  const list = targeted.length ? targetedResults : baseResults;
  return {
    hours,
    loaded: [...baseResults.data, ...targetedResults.data],
    list: list.data,
    loading: list.pending && !list.data.length,
    error: list.error,
    retry: list.retry,
  };
}

/** Encerrados na janela, por esporte e competição (o mais relevante primeiro), já filtrados. */
function FinishedGames({
  events,
  hours,
  loading,
  error,
  onRetry,
  sportLabel,
}: {
  events: Event[];
  hours: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  sportLabel: (slug: string) => string;
}) {
  const { locale, t } = useI18n();
  const tb = t.live.board;
  const groups = useMemo(() => groupLive(events, sportLabel), [events, sportLabel]);
  if (loading) return <CardsSkeleton count={3} />;
  const icon = <CircleCheck className="size-4" aria-hidden />;
  if (error && !events.length)
    return (
      <Section title={fill(tb.finished, { hours })} icon={icon}>
        <EmptyState title={tb.finishedErrorTitle} description={tb.finishedErrorDescription}>
          <Button variant="outline" size="sm" className="mx-auto" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t.live.filters.ui.retry}
          </Button>
        </EmptyState>
      </Section>
    );
  return (
    <Section
      title={
        events.length
          ? plural(locale, events.length, tb.finishedCount, { hours })
          : fill(tb.finished, { hours })
      }
      icon={icon}
    >
      {events.length ? (
        <GroupedEvents groups={groups} renderCard={(e) => <ClientEventCard key={e.id} event={e} />} />
      ) : (
        <p className="text-muted-foreground text-sm">{fill(t.live.filters.finishedEmpty, { hours })}</p>
      )}
    </Section>
  );
}

/**
 * Próximos apitos por esporte, já filtrados. Sem filtro e sem jogo marcado, a seção não aparece. Busca
 * que falhou e nada para mostrar: o erro, com "Tentar de novo" (não "nada bate com os filtros").
 */
function UpcomingKickoffs({
  groups,
  loading,
  filtered,
  error,
  onRetry,
  sportLabel,
}: {
  groups: UpcomingGroup[];
  loading: boolean;
  filtered: boolean;
  error: boolean;
  onRetry: () => void;
  sportLabel: (slug: string) => string;
}) {
  const { t } = useI18n();
  if (loading) return <CardsSkeleton count={3} />;
  if (error && !groups.length)
    return (
      <Section title={t.live.board.upcoming} icon={<CalendarClock className="size-4" aria-hidden />}>
        <EmptyState
          title={t.live.board.upcomingErrorTitle}
          description={t.live.board.upcomingErrorDescription}
        >
          <Button variant="outline" size="sm" className="mx-auto" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t.live.filters.ui.retry}
          </Button>
        </EmptyState>
      </Section>
    );
  if (!groups.length && !filtered) return null;
  return (
    <Section title={t.live.board.upcoming} icon={<CalendarClock className="size-4" aria-hidden />}>
      {groups.length ? (
        <div className="flex flex-col gap-6">
          {groups.map((g) => {
            const Icon = SPORTS.find((s) => s.slug === g.sport)?.icon;
            const label = sportLabel(g.sport);
            return (
              <section key={g.sport} className="flex flex-col gap-3" aria-label={label}>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {Icon ? <Icon className="size-4" aria-hidden /> : null}
                  {label}
                </h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {g.events.map((e) => (
                    <ClientEventCard key={e.id} event={e} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t.live.filters.upcomingEmpty}</p>
      )}
    </Section>
  );
}

/**
 * Grava os filtros na URL sem nova requisição ao servidor. O estado `null` é o que faz o Next sincronizar
 * o `useSearchParams` (com o estado interno dele, a chamada passa como se fosse do próprio roteador).
 */
function writeFilters(filters: LiveFilters) {
  const { pathname, search, hash } = window.location;
  window.history.replaceState(null, '', `${pathname}${liveFiltersSearch(filters, search)}${hash}`);
}

/**
 * Página Ao vivo: tudo que está em andamento agora, por esporte e competição, com placar e relógio que
 * se atualizam sozinhos (SSE do /v1/stream + verificação periódica) e o contador da cadência no topo.
 * A barra de filtros (status, esporte, país e competição, na URL) recorta os jogos ao vivo e os próximos
 * no navegador: a consulta e o SSE continuam sobre todos os jogos ao vivo (a sidebar divide a consulta).
 */
export function LiveBoard({ api }: { api: ApiRequest }) {
  const { locale, t } = useI18n();
  const tb = t.live.board;
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseLiveFilters(searchParams), [searchParams]);
  const filtered = hasLiveFilters(filters);
  const q = useQuery({
    queryKey: LIVE_EVENTS_KEY,
    queryFn: () => fetchLiveEvents(locale),
    staleTime: 10_000,
  });
  const up = useUpcoming(locale, filters);
  const showFinished = showsStatus(filters, 'finished');
  const upSports = useMemo(() => up.sports.map((s) => s.slug), [up.sports]);
  const done = useFinished(locale, filters, upSports, showFinished);
  const hydrated = useHydrated();
  const data = hydrated ? q.data : undefined;
  const events = useMemo(() => data ?? [], [data]);
  const refresh = useLiveRefresh({
    queryKey: LIVE_EVENTS_KEY,
    eventIds: events.map((e) => e.id),
    enabled: true,
    dataUpdatedAt: q.dataUpdatedAt,
    errorUpdatedAt: q.errorUpdatedAt,
  });
  const sourceLastAt = useMemo(() => {
    const times = events
      .map((e) => e.data_freshness.last_valid_at)
      .filter((x): x is string => !!x)
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    return times[0] ?? null;
  }, [events]);
  const sportLabel = useCallback(
    (slug: string) => {
      const nav = SPORTS.find((s) => s.slug === slug);
      return nav ? t.nav.sports[nav.slug] : slug;
    },
    [t],
  );
  const shown = useMemo(() => events.filter((e) => matchesLiveFilters(e, filters)), [events, filters]);
  const groups = useMemo(() => groupLive(shown, sportLabel), [shown, sportLabel]);
  // depois da hidratação, como o ao vivo (os dados são do navegador)
  const upList = hydrated ? up.list : [];
  const upLoaded = hydrated ? up.loaded : [];
  const upcomingGroups = groupUpcoming(
    upList.filter((e) => matchesLiveFilters(e, filters)),
    up.sports.map((s) => s.slug),
    filters.sport.length === 1
      ? UPCOMING_FETCH_LIMIT
      : filtered
        ? UPCOMING_PER_SPORT_FEW
        : UPCOMING_PER_SPORT,
  );
  const doneLoaded = hydrated && showFinished ? done.loaded : [];
  const doneShown = useMemo(() => {
    const seen = new Set<string>();
    return (hydrated && showFinished ? done.list : []).filter((e) => {
      if (seen.has(e.id) || !matchesLiveFilters(e, filters)) return false;
      seen.add(e.id);
      return true;
    });
  }, [hydrated, showFinished, done.list, filters]);
  const options = liveFilterOptions([...events, ...upLoaded, ...doneLoaded], filters, sportLabel, up.sports);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <LiveFilterBar filters={filters} options={options} onChange={writeFilters} />

      {!showsStatus(filters, 'live') ? null : !hydrated || q.isPending ? (
        <CardsSkeleton count={6} />
      ) : q.isError && !data ? (
        <EmptyState title={tb.errorTitle} description={tb.errorDescription}>
          <CircleAlert className="text-muted-foreground mx-auto size-5" aria-hidden />
        </EmptyState>
      ) : !events.length ? (
        <Section title={tb.liveGames} api={api}>
          <EmptyState title={tb.emptyTitle} description={tb.emptyDescription} />
        </Section>
      ) : !shown.length ? (
        <Section title={tb.liveGames} api={api}>
          <EmptyState
            title={t.live.filters.liveEmptyTitle}
            description={plural(locale, events.length, t.live.filters.liveEmptyDescription)}
          />
        </Section>
      ) : (
        <Section
          title={plural(locale, shown.length, t.live.nav.count)}
          description={tb.description}
          api={api}
        >
          <GroupedEvents groups={groups} renderCard={(e) => <LiveCard key={e.id} event={e} />} />
        </Section>
      )}

      {showsStatus(filters, 'upcoming') ? (
        <UpcomingKickoffs
          groups={upcomingGroups}
          loading={!hydrated || up.loading}
          filtered={filtered}
          error={hydrated && up.error}
          onRetry={up.retry}
          sportLabel={sportLabel}
        />
      ) : null}

      {showFinished ? (
        <FinishedGames
          events={doneShown}
          hours={done.hours}
          loading={!hydrated || done.loading}
          error={hydrated && done.error}
          onRetry={done.retry}
          sportLabel={sportLabel}
        />
      ) : null}

      {/* Rodapé fixo sobreposto à lista: `sticky` (e não `fixed`) para ocupar só a coluna do conteúdo, ao
          lado da barra lateral e do player acoplado, e terminar abaixo do último card no fim da rolagem, sem
          esconder nada. `mt-auto` o mantém no pé da tela quando a lista é curta; as margens negativas o
          levam às bordas da coluna e a área segura do iPhone fica por baixo do texto. */}
      <RefreshTimer
        state={refresh}
        sourceLastAt={sourceLastAt}
        className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 z-[5] -mx-4 -mb-4 mt-auto rounded-none border-x-0 border-b-0 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur md:-mx-6 md:-mb-6 md:px-6"
      />
    </div>
  );
}
