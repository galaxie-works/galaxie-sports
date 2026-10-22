import type { Event } from '@galaxie/contracts';
import Link from 'next/link';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { EventCard } from '@/components/sport/event-card';
import { Section } from '@/components/sport/section';
import { StandingsTable } from '@/components/sport/standings-table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COMPETITION_TYPE_LABEL } from '@/lib/format';
import { getCompetition, getCompetitionEvents, getSeasonsWithData, getStandings } from '@/lib/galaxie/api';
import { cn } from '@/lib/utils';

/** Quantas temporadas (das mais recentes) a demo verifica e oferece. */
const MAX_SEASONS = 6;

interface Round {
  name: string;
  events: Event[];
}

/** Agrupa os jogos por rodada/fase, na ordem em que acontecem. */
function groupByRound(events: Event[]): Round[] {
  const rounds = new Map<string, Event[]>();
  for (const e of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const name = e.stage?.name ?? 'Jogos';
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

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        'rounded-full border px-3 py-1 text-xs whitespace-nowrap transition-colors',
        active ? 'bg-foreground text-background border-transparent' : 'hover:bg-accent',
      )}
    >
      {children}
    </Link>
  );
}

async function Content({ params, searchParams }: PageProps<'/competicoes/[id]'>) {
  const { id } = await params;
  const query = await searchParams;
  const competition = await getCompetition(id);

  const windows = competition.seasons
    .filter((s) => s.start_date && s.end_date)
    .sort((a, b) => b.year - a.year)
    .slice(0, MAX_SEASONS)
    .map((s) => ({ year: s.year, start: s.start_date!, end: s.end_date! }));
  const available = await getSeasonsWithData(competition.id, windows);

  const requested = Number(query.temporada);
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
          selected.hasStandings ? getStandings(competition.id, selected.year) : null,
          getCompetitionEvents(competition.id, window.start, window.end),
        ])
      : [null, [] as Event[]];

  const rounds = groupByRound(events);
  const round = rounds.find((r) => r.name === query.rodada) ?? defaultRound(rounds);
  const groups = (standings?.groups ?? []).filter((g) => g.rows.length > 0);
  const base = `/competicoes/${competition.slug}`;
  const seasonQuery = selected ? `temporada=${selected.year}` : '';

  return (
    <>
      <PageHeader title={competition.name} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Crest src={competition.logo} name={competition.name} size="xl" />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{competition.name}</h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{COMPETITION_TYPE_LABEL[competition.type] ?? competition.type}</Badge>
              {competition.country ? (
                <Link href={`/paises/${competition.country.code.toLowerCase()}`} className="hover:underline">
                  {competition.country.name}
                </Link>
              ) : null}
              {competition.official_name && competition.official_name !== competition.name ? (
                <span>· Nome oficial: {competition.official_name}</span>
              ) : null}
              {competition.trophy_nickname ? <span>· Taça: {competition.trophy_nickname}</span> : null}
            </div>
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
          <EmptyState
            title="Sem jogos sincronizados"
            description="Esta competição está no catálogo, mas ainda não tem temporadas com jogos ou classificação."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Temporada</span>
              {available.map((s) => (
                <Chip key={s.year} href={`${base}?temporada=${s.year}`} active={s.year === selected?.year}>
                  {competition.seasons.find((x) => x.year === s.year)?.label ?? s.year}
                </Chip>
              ))}
            </div>

            <Tabs key={selected?.year} defaultValue={groups.length ? 'classificacao' : 'jogos'}>
              <TabsList>
                <TabsTrigger value="classificacao" disabled={!groups.length}>
                  Classificação
                </TabsTrigger>
                <TabsTrigger value="jogos">Jogos</TabsTrigger>
              </TabsList>

              <TabsContent value="classificacao" className="flex flex-col gap-6 pt-4">
                {groups.map((g) => (
                  <Section
                    key={g.name ?? 'geral'}
                    title={groups.length > 1 && g.name ? g.name : 'Classificação'}
                  >
                    <StandingsTable rows={g.rows} />
                  </Section>
                ))}
              </TabsContent>

              <TabsContent value="jogos" className="flex flex-col gap-4 pt-4">
                {rounds.length > 1 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {rounds.map((r) => (
                      <Chip
                        key={r.name}
                        href={`${base}?${seasonQuery}&rodada=${encodeURIComponent(r.name)}`}
                        active={r.name === round?.name}
                      >
                        {r.name}
                      </Chip>
                    ))}
                  </div>
                ) : null}
                {round ? (
                  <Section title={round.name} description={`${round.events.length} jogos`}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {round.events.map((e) => (
                        <EventCard key={e.id} event={e} showCompetition={false} />
                      ))}
                    </div>
                  </Section>
                ) : (
                  <EmptyState title="Sem jogos nesta temporada" />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </>
  );
}

function Fallback() {
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

export default function CompetitionPage(props: PageProps<'/competicoes/[id]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content {...props} />
    </Suspense>
  );
}
